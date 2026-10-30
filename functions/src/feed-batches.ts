/** Purchase quantities and money stay attached to their original lot.
 * Remaining value is allocated proportionally; the last withdrawal gets the
 * remainder, so rounding can never create or destroy invoice value.
 */
export type FeedBatch = {
  id: string;
  receivedAt: string;
  quantity: number;
  remaining: number;
  valueCents: number;
  remainingCents: number;
  unvalued?: boolean;
};
export type FeedPortion = {
  batchId: string;
  quantity: number;
  valueCents: number;
  unvalued?: boolean;
};
const precision = (n: number) => Math.round(n * 1e8) / 1e8;
function check(batches: FeedBatch[]) {
  const ids = new Set<string>();
  for (const b of batches) {
    if (
      !b.id ||
      ids.has(b.id) ||
      !Number.isFinite(Date.parse(b.receivedAt)) ||
      !Number.isFinite(b.quantity) ||
      b.quantity <= 0 ||
      !Number.isFinite(b.remaining) ||
      b.remaining < 0 ||
      b.remaining > b.quantity ||
      !Number.isSafeInteger(b.valueCents) ||
      b.valueCents < 0 ||
      !Number.isSafeInteger(b.remainingCents) ||
      b.remainingCents < 0 ||
      b.remainingCents > b.valueCents ||
      (b.remaining === 0 && b.remainingCents !== 0)
    )
      throw new Error("دفعات المخزون غير متوازنة؛ راجع سجل الدفعات");
    ids.add(b.id);
  }
}
export function addFeedBatch(
  input: FeedBatch[],
  id: string,
  receivedAt: string,
  quantity: number,
  total: number,
) {
  const batches = structuredClone(input);
  check(batches);
  const valueCents = Math.round(total * 100);
  if (
    !Number.isFinite(total) ||
    total <= 0 ||
    !Number.isSafeInteger(valueCents) ||
    valueCents <= 0 ||
    !Number.isFinite(quantity) ||
    quantity <= 0 ||
    precision(quantity) !== quantity
  )
    throw new Error("كمية الدفعة أو قيمتها غير صالحة");
  const old = batches.find((b) => b.id === id);
  if (old) {
    if (
      old.receivedAt !== receivedAt ||
      old.quantity !== quantity ||
      old.valueCents !== valueCents
    )
      throw new Error("معرف الدفعة مستخدم لشراء مختلف");
    return batches;
  }
  batches.push({
    id,
    receivedAt,
    quantity,
    remaining: quantity,
    valueCents,
    remainingCents: valueCents,
  });
  check(batches);
  return batches;
}
export function takeFeedBatches(
  input: FeedBatch[],
  quantity: number,
  through: string,
) {
  const batches = structuredClone(input),
    portions: FeedPortion[] = [];
  check(batches);
  if (
    !Number.isFinite(quantity) ||
    quantity < 0 ||
    precision(quantity) !== quantity ||
    !Number.isFinite(Date.parse(through))
  )
    throw new Error("كمية الصرف أو تاريخه غير صالح");
  let uncosted = quantity;
  for (const b of [...batches].sort(
    (a, b) =>
      Date.parse(a.receivedAt) - Date.parse(b.receivedAt) ||
      a.id.localeCompare(b.id),
  )) {
    if (!uncosted) break;
    if (!b.remaining || Date.parse(b.receivedAt) > Date.parse(through))
      continue;
    const amount = Math.min(uncosted, b.remaining);
    const valueCents =
      amount === b.remaining
        ? b.remainingCents
        : Math.round((b.remainingCents * amount) / b.remaining);
    b.remaining = precision(b.remaining - amount);
    b.remainingCents -= valueCents;
    uncosted = precision(uncosted - amount);
    portions.push({
      batchId: b.id,
      quantity: amount,
      valueCents,
      ...(b.unvalued ? { unvalued: true } : {}),
    });
  }
  check(batches);
  return {
    batches,
    portions,
    uncosted: precision(
      uncosted +
        portions.filter((p) => p.unvalued).reduce((n, p) => n + p.quantity, 0),
    ),
    valueCents: portions.reduce((n, p) => n + p.valueCents, 0),
  };
}
/** The caller records the reversal source once in the transaction ledger. */
export function returnFeedPortions(
  input: FeedBatch[],
  portions: FeedPortion[],
) {
  const batches = structuredClone(input);
  check(batches);
  for (const p of portions) {
    const b = batches.find((b) => b.id === p.batchId);
    if (
      !b ||
      !Number.isFinite(p.quantity) ||
      p.quantity <= 0 ||
      !Number.isSafeInteger(p.valueCents) ||
      p.valueCents < 0
    )
      throw new Error("تعذر ربط تصحيح التغذية بالدفعة الأصلية");
    b.remaining = precision(b.remaining + p.quantity);
    b.remainingCents += p.valueCents;
  }
  check(batches);
  return batches;
}
