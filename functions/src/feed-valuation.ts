import type { Row, State } from "./domain";
import {
  addFeedBatch,
  takeFeedBatches,
  type FeedBatch,
  type FeedPortion,
} from "./feed-batches";
import { stockPrecision, feedingSkipped, horsePresentOn } from "./feeding";
import { businessDay } from "./dates";

/** A transition never invents old invoices or changes previously calculated days. */
export function initializeFeedBatches(
  meal: Row,
  now: string,
  history: Row[] = [],
) {
  if (meal.feedBatches) return;
  meal.feedBatches = [];
  meal.batchCostFrom = businessDay(now);
  meal.legacyFeedPrice = Number(meal.pricePerUnit || 0);
  // Recover only a complete, unambiguous FIFO movement chain. Corrections or
  // returns without original lot links need explicit valuation, never guesses.
  const rows = history
    .filter((t) => t.mealTypeId === meal.id)
    .sort(
      (a, b) =>
        String(a.createdAt).localeCompare(String(b.createdAt)) ||
        a.id.localeCompare(b.id),
    );
  let recovered: FeedBatch[] = [],
    balance = 0,
    safe = rows.length > 0;
  for (const t of rows) {
    if (!safe) break;
    if (
      !Number.isFinite(t.amount) ||
      !Number.isFinite(t.balance) ||
      !Number.isFinite(Date.parse(t.createdAt)) ||
      (t.unit && t.unit !== meal.unit) ||
      [
        "purchase_correction",
        "feeding_correction",
        "opening_valuation",
      ].includes(t.movementKind)
    ) {
      safe = false;
      break;
    }
    const delta = t.type === "add" ? t.amount : -t.amount;
    if (stockPrecision(balance + delta) !== t.balance) {
      safe = false;
      break;
    }
    if (delta > 0) {
      if (t.movementKind === "purchase" && t.total > 0)
        recovered = addFeedBatch(recovered, t.id, t.createdAt, delta, t.total);
      else
        recovered.push({
          id: t.id,
          receivedAt: t.createdAt,
          quantity: delta,
          remaining: delta,
          valueCents: 0,
          remainingCents: 0,
          unvalued: true,
        });
    } else if (delta < 0)
      recovered = takeFeedBatches(
        recovered,
        Math.min(-delta, Math.max(0, balance)),
        t.createdAt,
      ).batches;
    balance = t.balance;
  }
  if (safe && balance === meal.currentStock) meal.feedBatches = recovered;
  else if (meal.currentStock > 0)
    addUnvaluedStock(
      meal,
      `opening_${meal.id}`,
      meal.currentStock,
      businessDay(now) + "T00:00:00+03:00",
    );
}
export function addUnvaluedStock(
  meal: Row,
  id: string,
  quantity: number,
  now: string,
) {
  if (!(quantity > 0)) return;
  meal.feedBatches.push({
    id,
    receivedAt: now,
    quantity,
    remaining: quantity,
    valueCents: 0,
    remainingCents: 0,
    unvalued: true,
  });
}
export function purchaseFeedBatch(
  meal: Row,
  id: string,
  quantity: number,
  total: number,
  now: string,
  history: Row[] = [],
) {
  initializeFeedBatches(meal, now, history);
  // A prior shortage remains a shortage, rather than being silently funded at a new price.
  const shortage = Math.max(0, -Number(meal.currentStock || 0));
  meal.feedBatches = addFeedBatch(meal.feedBatches, id, now, quantity, total);
  if (shortage) {
    const taken = takeFeedBatches(
      meal.feedBatches,
      Math.min(shortage, quantity),
      now,
    );
    meal.feedBatches = taken.batches;
    return taken;
  }
  return null;
}
export function batchStockValue(meal: Row) {
  const batches: FeedBatch[] = meal.feedBatches || [];
  return {
    value: batches.reduce((n, b) => n + b.remainingCents, 0) / 100,
    unvalued: stockPrecision(
      batches.filter((b) => b.unvalued).reduce((n, b) => n + b.remaining, 0),
    ),
  };
}
export function validateBatchBalance(meal: Row) {
  if (!meal.feedBatches) return;
  const quantity = stockPrecision(
    (meal.feedBatches as FeedBatch[]).reduce((n, b) => n + b.remaining, 0),
  );
  if (quantity !== stockPrecision(Math.max(0, Number(meal.currentStock))))
    throw new Error("رصيد الدفعات لا يطابق كمية المخزون؛ لم تحفظ العملية");
}
/** An explicit invoice correction can revalue recorded consumption, but closed
 * summaries stay frozen. Their difference becomes a current-period adjustment.
 */
export function correctFeedBatch(
  s: State,
  meal: Row,
  id: string,
  quantity: number,
  total: number,
  stockDelta: number,
  correctionId: string,
  today: string,
) {
  const batch: FeedBatch | undefined = meal.feedBatches?.find(
    (b: FeedBatch) => b.id === id,
  );
  if (!batch) return;
  const used = stockPrecision(batch.quantity - batch.remaining),
    remaining = stockPrecision(batch.remaining + stockDelta);
  if (remaining < 0 || quantity < used || remaining > quantity)
    throw new Error(
      "الكمية المصححة أقل من المصروف من الدفعة؛ راجع الجرد أولًا",
    );
  const cents = Math.round(total * 100),
    oldCents = batch.valueCents;
  const newRemainingCents = quantity
    ? Math.round((cents * remaining) / quantity)
    : 0;
  const changes: Row[] = [];
  const active: { movement: Row; portion: Row; part: FeedPortion }[] = [];
  for (const movement of s.inventoryTransactions.filter(
    (t) => t.movementKind === "feeding" && t.mealTypeId === meal.id,
  )) {
    for (const portion of movement.breakdown || []) {
      const horse = s.horses.find((h) => h.id === portion.horseId);
      if (
        horse &&
        (feedingSkipped(horse, meal.id, movement.feedingDate) ||
          !horsePresentOn(horse, movement.feedingDate))
      )
        continue;
      if (
        s.inventoryTransactions.some((t) =>
          t.reversalSources?.includes(`${movement.id}:${portion.horseId}`),
        )
      )
        continue;
      const parts: FeedPortion[] = portion.batchPortions || [];
      for (const part of parts.filter((p) => p.batchId === id)) {
        active.push({ movement, portion, part });
      }
    }
  }
  let allocatedQuantity = 0,
    allocatedCents = 0;
  const activeQuantity = stockPrecision(
    active.reduce((n, x) => n + x.part.quantity, 0),
  );
  if (activeQuantity > stockPrecision(quantity - remaining))
    throw new Error(
      "تصحيح الكمية يتعارض مع حصص تغذية مسجلة؛ راجع الجرد والكمية الأصلية",
    );
  for (const { movement, portion, part } of active) {
    allocatedQuantity = stockPrecision(allocatedQuantity + part.quantity);
    const cumulative = Math.round(
      ((cents - newRemainingCents) * allocatedQuantity) /
        (quantity - remaining),
    );
    const next = cumulative - allocatedCents,
      delta = next - part.valueCents;
    allocatedCents = cumulative;
    if (!delta) continue;
    changes.push({
      id: `${movement.id}:${portion.horseId}`,
      horseId: portion.horseId,
      date: movement.feedingDate,
      previousCents: part.valueCents,
      valueCents: next,
      closedPeriod: s.financialPeriods.some(
        (p) => p.id === movement.feedingDate.slice(0, 7) && p.closed,
      ),
    });
    part.valueCents = next;
    portion.batchCostCents = (portion.batchPortions as FeedPortion[]).reduce(
      (n, p) => n + p.valueCents,
      0,
    );
  }
  batch.quantity = quantity;
  batch.remaining = remaining;
  batch.valueCents = cents;
  batch.remainingCents = newRemainingCents;
  return {
    previousValueCents: oldCents,
    valueCents: cents,
    changes,
    correctionId,
    settlementDate: today,
    otherConsumedCents: cents - newRemainingCents - allocatedCents,
  };
}
