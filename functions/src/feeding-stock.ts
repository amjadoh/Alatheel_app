import type { Row, State } from "./domain";
import { addFeedingDays, feedingAtDate, feedingMeasure, feedingOnDate, feedingSkipped, horsePresentOn, stockPrecision } from "./feeding";
import { businessDay } from "./dates";

export const feedingLedgerId = (mealId: string, day: string) => `feeding_${mealId}_${day}`;
export const hasPendingFeeding = (s: State, throughDate: string) => s.mealTypes.some(m =>
  m.autoFeedingFrom && m.autoFeedingFrom <= throughDate &&
  (!m.autoFeedingThrough || m.autoFeedingThrough < throughDate));

/** One immutable aggregate movement per item/day, including the individual horse portions.
 * Never creates expenses or payments. Negative stock preserves the full shortage instead of losing consumption.
 * Seven business days / 300 ledger rows bound Firestore transaction writes; rerun safely for a backlog.
 */
export function consumeScheduledFeeding(input: State, throughDate: string, now = new Date().toISOString(), maxDays = 7): State {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(throughDate)) throw new Error("التاريخ غير صحيح");
  const s = structuredClone(input);
  let movements = 0, changedItems = 0;
  for (const meal of [...s.mealTypes].sort((a, b) => a.id.localeCompare(b.id))) {
    if (!meal.autoFeedingFrom || changedItems >= 80) continue;
    let day = meal.autoFeedingThrough ? addFeedingDays(meal.autoFeedingThrough, 1) : meal.autoFeedingFrom;
    day = day < meal.autoFeedingFrom ? meal.autoFeedingFrom : day;
    if (day <= throughDate) changedItems++;
    let days = 0;
    while (day <= throughDate && days++ < Math.max(1, Math.min(maxDays, 31)) && movements < 300) {
      const id = feedingLedgerId(meal.id, day);
      if (!s.inventoryTransactions.some(t => t.id === id)) {
        const breakdown: Row[] = [];
        const measure = feedingMeasure(meal);
        for (const horse of s.horses) {
          if (!horsePresentOn(horse, day) || feedingSkipped(horse, meal.id, day)) continue;
          for (const plan of feedingAtDate(horse, day).filter(f => f.mealTypeId === meal.id && feedingOnDate(f, day))) {
            const quantity = Number(plan.quantity || 0);
            if (!(quantity > 0)) continue;
            breakdown.push({ id: horse.id, horseId: horse.id, horseName: horse.name || "", quantity,
              amount: stockPrecision(quantity / measure.unitsPerPurchaseUnit),
              feedingUnit: measure.unit, unitPrice: Number(meal.pricePerUnit || 0),
              planVersion: horse.feedingHistory?.filter((v: Row) => v.from <= day).at(-1)?.from || "legacy_daily" });
          }
        }
        const amount = stockPrecision(breakdown.reduce((n, b) => n + b.amount, 0));
        if (amount) {
          meal.currentStock = stockPrecision(Number(meal.currentStock || 0) - amount);
          s.inventoryTransactions.push({ id, mealTypeId: meal.id, mealName: meal.name,
            movementKind: "feeding", type: "remove", amount, feedingDate: day,
            unit: meal.unit, breakdown, balance: meal.currentStock,
            reason: "استهلاك التغذية التلقائي", performedBy: "system", createdAt: now });
          movements++;
        }
      }
      meal.autoFeedingThrough = day;
      day = addFeedingDays(day, 1);
    }
  }
  return s;
}

/** Compensate recorded portions only, preserving the original movement and its audit trail. */
export function reverseFeedingPortions(s: State, horse: Row, dates: (day: string) => boolean,
  requestId: string, now: string, reason: string, mealTypeId?: string) {
  const totals = new Map<string, { amount: number; sourceIds: string[] }>();
  for (const movement of s.inventoryTransactions.filter(t => t.movementKind === "feeding" && dates(t.feedingDate) && (!mealTypeId || t.mealTypeId === mealTypeId))) {
    const meal = s.mealTypes.find(m => m.id === movement.mealTypeId);
    // A later actual count has already absorbed the difference; never credit it a second time.
    if (meal?.stockReconciledAt && movement.feedingDate <= businessDay(meal.stockReconciledAt)) continue;
    const sourceKey = `${movement.id}:${horse.id}`;
    if (s.inventoryTransactions.some(t => t.reversalSources?.includes(sourceKey))) continue;
    const amount = (movement.breakdown || []).filter((b: Row) => b.horseId === horse.id).reduce((n: number, b: Row) => n + b.amount, 0);
    if (!amount) continue;
    const total = totals.get(movement.mealTypeId) || { amount: 0, sourceIds: [] };
    total.amount += amount; total.sourceIds.push(sourceKey); totals.set(movement.mealTypeId, total);
  }
  for (const [id, total] of totals) {
    const meal = s.mealTypes.find(m => m.id === id);
    if (!meal) continue;
    const amount = stockPrecision(total.amount);
    meal.currentStock = stockPrecision(Number(meal.currentStock || 0) + amount);
    s.inventoryTransactions.push({ id: `feeding_reverse_${requestId}_${id}`, mealTypeId: id,
      mealName: meal.name, movementKind: "feeding_correction", type: "add", amount,
      balance: meal.currentStock, horseId: horse.id, reversalSources: total.sourceIds,
      reason, performedBy: "system", createdAt: now });
  }
}
