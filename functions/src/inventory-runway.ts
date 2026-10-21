import type { Row, State } from "./domain";
import { addFeedingDays, feedingMeasure, horsePresentOn, scheduledFeedingDates, stockPrecision } from "./feeding";
import { inventoryCycle } from "./inventory-needs";

type RunwayStatus = "shortage" | "within_horizon" | "beyond_horizon" | "no_consumption" | "incomplete";
const MAX_PENDING_DAYS = 366;

/** Read-only planning from recorded feeding, not a purchase, expense or stock movement.
 * stockoutDate is the first feeding day the balance cannot fully cover, including
 * today when appropriate. The item is bought/provided on that day; no delivery
 * delay or earlier order date is assumed.
 * Dates are withheld for incomplete schedules, invalid stock or an excessive backlog.
 */
export function inventoryRunway(state: State, today: string, options: { horizonDays?: number } = {}) {
  inventoryCycle(today); // Shared strict ISO calendar-date validation.
  const horizonDays = options.horizonDays ?? 180;
  if (!Number.isInteger(horizonDays) || horizonDays < 1 || horizonDays > 180)
    throw new Error("مدة التوقع يجب أن تكون من يوم إلى 180 يومًا");
  const horizonEnd = addFeedingDays(today, horizonDays - 1);
  const historyFloor = addFeedingDays(today, -MAX_PENDING_DAYS);
  const recorded = new Set(state.inventoryTransactions
    .filter(row => row.movementKind === "feeding")
    .map(row => `${row.mealTypeId}:${row.feedingDate}`));
  const prepared = state.mealTypes.map(meal => {
    const measure = feedingMeasure(meal);
    const hasExplicitMeasure = !!meal.feedingUnit || meal.feedingUnitsPerPurchaseUnit != null;
    const explicitFactor = Number(meal.feedingUnitsPerPurchaseUnit);
    const needsUnitData = hasExplicitMeasure && (!meal.feedingUnit || !Number.isFinite(explicitFactor) || explicitFactor <= 0);
    const from = meal.autoFeedingFrom as string | undefined;
    const afterThrough = meal.autoFeedingThrough ? addFeedingDays(meal.autoFeedingThrough, 1) : from;
    const pendingFrom = from && afterThrough ? (from > afterThrough ? from : afterThrough) : undefined;
    const pendingIncomplete = !!(pendingFrom && pendingFrom < historyFloor);
    return { meal, measure, needsUnitData, pendingFrom, pendingIncomplete, pending: 0,
      unscheduled: new Set<string>(), unknownQuantities: new Set<string>(), demand: new Map<string, number>() };
  });
  const byMeal = new Map(prepared.map(item => [item.meal.id, item]));
  let first = today;
  for (const item of prepared) if (item.pendingFrom && item.pendingFrom < first)
    first = item.pendingFrom < historyFloor ? historyFloor : item.pendingFrom;
  // Sort historical plan versions only once per horse, then walk them in date order.
  // Each day's plans are distributed across items in one pass, rather than rescanning
  // all horses/history separately for every item and every forecast day.
  const horses = state.horses.map(horse => ({
    horse,
    versions: (horse.feedingHistory || []).slice().sort((a: Row, b: Row) =>
      String(a.from).localeCompare(String(b.from)) || String(a.createdAt || "").localeCompare(String(b.createdAt || ""))),
    version: -1,
    skipped: new Set((horse.feedingSkips || []).map((skip: Row) => `${skip.mealTypeId}:${skip.date}`)),
  }));
  // A plan's ordinal dates are derived once per calendar month, never from an
  // averaged "times per month" rate or fixed 30-day approximation.
  const scheduleCache = new WeakMap<object, Map<string, Set<string> | null>>();
  const datesFor = (plan: Row, month: string) => {
    let months = scheduleCache.get(plan);
    if (!months) { months = new Map(); scheduleCache.set(plan, months); }
    if (months.has(month)) return months.get(month)!;
    const slots = plan.schedule;
    const expected = plan.timesPerMonth == null ? slots?.length : Number(plan.timesPerMonth);
    const valid = Array.isArray(slots) && slots.length > 0 && slots.length === expected &&
      slots.every(slot => Number.isInteger(slot.weekday) && slot.weekday >= 0 && slot.weekday <= 6 &&
        Number.isInteger(slot.ordinal) && slot.ordinal >= 1 && slot.ordinal <= 4) &&
      new Set(slots.map(slot => `${slot.weekday}:${slot.ordinal}`)).size === slots.length;
    const dates = valid ? new Set(scheduledFeedingDates(plan, month)) : null;
    months.set(month, dates);
    return dates;
  };
  for (let date = first; date <= horizonEnd; date = addFeedingDays(date, 1)) {
    for (const h of horses) {
      while (h.version + 1 < h.versions.length && h.versions[h.version + 1].from <= date) h.version++;
      if (!horsePresentOn(h.horse, date)) continue;
      const plans: Row[] = h.versions.length
        ? h.versions[h.version]?.feeding || [] : h.horse.feeding || [];
      for (const plan of plans) {
        const item = byMeal.get(plan.mealTypeId), quantity = Number(plan.quantity);
        if (!item || h.skipped.has(`${plan.mealTypeId}:${date}`)) continue;
        const processed = recorded.has(`${item.meal.id}:${date}`) ||
          !!(item.meal.autoFeedingThrough && date <= item.meal.autoFeedingThrough);
        if (processed || date < today && (!item.pendingFrom || date < item.pendingFrom)) continue;
        if (!(quantity > 0) || !Number.isFinite(quantity)) {
          item.unknownQuantities.add(h.horse.name || h.horse.id);
          continue;
        }
        if ((plan.frequency || "daily") !== "daily") {
          const dates = datesFor(plan, date.slice(0, 7));
          if (!dates) { item.unscheduled.add(h.horse.name || h.horse.id); continue; }
          if (!dates.has(date)) continue;
        }
        if (date < today) item.pending += quantity;
        else item.demand.set(date, (item.demand.get(date) || 0) + quantity);
      }
    }
  }
  const items = prepared.map(({ meal, measure, needsUnitData, pending, pendingIncomplete, unscheduled, unknownQuantities, demand }) => {
    const rawStock = Number(meal.currentStock ?? 0);
    const needsStockData = !Number.isFinite(rawStock);
    const stock = stockPrecision((needsStockData ? 0 : rawStock) * measure.unitsPerPurchaseUnit);
    pending = stockPrecision(pending);
    const available = stockPrecision(stock - pending);
    const needsScheduleData = unscheduled.size > 0;
    const needsQuantityData = unknownQuantities.size > 0;
    const incomplete = needsScheduleData || needsQuantityData || needsUnitData || pendingIncomplete || needsStockData;
    let balance = available, required = 0;
    let stockoutDate: string | undefined = available < 0 ? today : undefined;
    for (const [date, amount] of demand) {
      required = stockPrecision(required + amount);
      balance = stockPrecision(balance - stockPrecision(amount));
      if (balance < 0 && !stockoutDate) stockoutDate = date;
    }
    if (incomplete) stockoutDate = undefined;
    const lastCoveredDate = incomplete ? undefined : stockoutDate
      ? addFeedingDays(stockoutDate, -1) : required > 0 ? horizonEnd : undefined;
    const status: RunwayStatus = incomplete ? "incomplete" : stockoutDate
      ? stockoutDate <= today ? "shortage" : "within_horizon"
      : required > 0 ? "beyond_horizon" : "no_consumption";
    return { id: String(meal.id), unit: measure.unit, purchaseUnit: String(meal.unit || "وحدة"),
      conversion: measure.unitsPerPurchaseUnit, stock, pending, available,
      required: stockPrecision(required), endingBalance: balance, emptyNow: available <= 0,
      firstDemandDate: demand.keys().next().value as string | undefined,
      stockoutDate, lastCoveredDate, needsProvidingDate: stockoutDate,
      needsScheduleData, needsStockData, needsQuantityData, needsUnitData, pendingIncomplete,
      unscheduled: [...unscheduled], unknownQuantities: [...unknownQuantities], incomplete, status };
  });
  return { today, horizonEnd, horizonDays, items, incomplete: items.some(item => item.incomplete) };
}

export type InventoryRunway = ReturnType<typeof inventoryRunway>;
export type ItemRunway = InventoryRunway["items"][number];
