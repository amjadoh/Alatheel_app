import type { State } from "./domain";
import { addFeedingDays, feedingAtDate, feedingMeasure, feedingOnDate, feedingSkipped, horsePresentOn, stockPrecision } from "./feeding";

/** Inventory planning only: never changes a balance, payment, or closed financial period. */
export function inventoryCycle(day: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(Date.parse(day + "T12:00:00Z")) ||
      new Date(day + "T12:00:00Z").toISOString().slice(0, 10) !== day) throw new Error("التاريخ غير صحيح");
  const date = new Date(day + "T12:00:00Z");
  const offset = date.getUTCDate() > 27 ? 1 : 0;
  const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + offset, 27)).toISOString().slice(0, 10);
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + offset - 1, 28)).toISOString().slice(0, 10);
  return { today: day, start, end };
}

export function inventoryNeeds(state: State, day: string) {
  const cycle = inventoryCycle(day);
  const recorded = new Set(state.inventoryTransactions.filter(t => t.movementKind === "feeding").map(t => `${t.mealTypeId}:${t.feedingDate}`));
  const items = state.mealTypes.map(meal => {
    const measure = feedingMeasure(meal);
    const byHorse = new Map<string, { id: string; name: string; quantity: number; dates: string[] }>();
    const unscheduled = new Set<string>();
    let remaining = 0, cycleQuantity = 0, pending = 0;
    const processed = (date: string) => recorded.has(`${meal.id}:${date}`) || !!(meal.autoFeedingThrough && date <= meal.autoFeedingThrough);
    // An overdue server batch is reserved separately, rather than presenting stale stock as available.
    const pendingFrom = meal.autoFeedingFrom && (meal.autoFeedingThrough ? addFeedingDays(meal.autoFeedingThrough, 1) : meal.autoFeedingFrom);
    const first = pendingFrom && pendingFrom < cycle.start ? pendingFrom : cycle.start;
    for (let date = first; date <= cycle.end; date = addFeedingDays(date, 1)) {
      for (const horse of state.horses) {
        if (!horsePresentOn(horse, date) || feedingSkipped(horse, meal.id, date)) continue;
        for (const plan of feedingAtDate(horse, date).filter(p => p.mealTypeId === meal.id)) {
          const quantity = Number(plan.quantity);
          if (!(quantity > 0) || !Number.isFinite(quantity)) continue;
          if ((plan.frequency || "daily") !== "daily" && !plan.schedule?.length) {
            if (date >= day && !processed(date)) unscheduled.add(horse.name || horse.id);
            continue;
          }
          if (!feedingOnDate(plan, date)) continue;
          if (date >= cycle.start) cycleQuantity += quantity;
          if (date < day) {
            if (pendingFrom && date >= pendingFrom && date >= meal.autoFeedingFrom && !processed(date)) pending += quantity;
          } else if (!processed(date)) {
            remaining += quantity;
            const row = byHorse.get(horse.id) || { id: horse.id, name: horse.name || "خيل", quantity: 0, dates: [] as string[] };
            row.quantity += quantity;
            if (!row.dates.includes(date)) row.dates.push(date);
            byHorse.set(horse.id, row);
          }
        }
      }
    }
    const stock = stockPrecision(Number(meal.currentStock || 0) * measure.unitsPerPurchaseUnit);
    pending = stockPrecision(pending); remaining = stockPrecision(remaining);
    const available = stockPrecision(stock - pending);
    const shortage = stockPrecision(Math.max(0, remaining - available));
    const purchaseQuantity = stockPrecision(shortage / measure.unitsPerPurchaseUnit);
    const price = Number(meal.pricePerUnit);
    return {
      id: meal.id, unit: measure.unit, purchaseUnit: String(meal.unit || "وحدة"), conversion: measure.unitsPerPurchaseUnit,
      stock, pending, available, remaining, cycleQuantity: stockPrecision(cycleQuantity), shortage, purchaseQuantity,
      surplus: stockPrecision(Math.max(0, available - remaining)),
      cost: Number.isFinite(price) && price > 0 ? Math.round(purchaseQuantity * price * 100) / 100 : undefined,
      unscheduled: [...unscheduled],
      horses: [...byHorse.values()].map(h => ({ ...h, quantity: stockPrecision(h.quantity) })),
    };
  });
  return { ...cycle, items, needCount: items.filter(i => i.shortage > 0).length,
    incomplete: items.some(i => i.unscheduled.length > 0),
    missingPrices: items.some(i => i.shortage > 0 && i.cost === undefined),
    cost: Math.round(items.reduce((n, i) => n + (i.cost || 0), 0) * 100) / 100 };
}

export type InventoryNeeds = ReturnType<typeof inventoryNeeds>;
export type ItemNeeds = InventoryNeeds["items"][number];
