import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addFeedBatch,
  takeFeedBatches,
  returnFeedPortions,
} from "../functions/src/feed-batches";
const first = "2026-10-01T00:00:00Z",
  second = "2026-11-01T00:00:00Z";
test("owner example: old three kilograms retain 30 and new ten retain 150, without averaging", () => {
  const original = addFeedBatch([], "old", first, 10, 100);
  const october = takeFeedBatches(original, 7, first);
  assert.equal(october.valueCents, 7000);
  const stock = addFeedBatch(october.batches, "new", second, 10, 150);
  assert.equal(
    stock.reduce((n, b) => n + b.remainingCents, 0),
    18000,
  );
  const november = takeFeedBatches(stock, 5, second);
  assert.deepEqual(november.portions, [
    { batchId: "old", quantity: 3, valueCents: 3000 },
    { batchId: "new", quantity: 2, valueCents: 3000 },
  ]);
  assert.equal(november.valueCents, 6000);
  assert.equal(
    november.batches.reduce((n, b) => n + b.remainingCents, 0),
    12000,
  );
  assert.equal(stock[0].remaining, 3); // calculation does not mutate its input
  assert.equal(original[0].remaining, 10);
});
test("all invoice cents survive many fractional withdrawals and a reversal", () => {
  const opening = addFeedBatch([], "bag", first, 1, 10);
  let batches = opening,
    spent = 0;
  for (let i = 0; i < 99; i++) {
    const r = takeFeedBatches(batches, 0.01, first);
    batches = r.batches;
    spent += r.valueCents;
  }
  const last = takeFeedBatches(batches, 0.01, first);
  spent += last.valueCents;
  assert.equal(spent, 1000);
  assert.equal(last.batches[0].remainingCents, 0);
  const returned = returnFeedPortions(last.batches, last.portions);
  assert.equal(returned[0].remaining, 0.01);
  assert.equal(
    takeFeedBatches(returned, 0.01, first).valueCents,
    last.valueCents,
  );
  assert.throws(() => returnFeedPortions(opening, last.portions));
});
test("future purchases never fund past feeding; shortages remain explicitly uncosted", () => {
  const stock = addFeedBatch([], "future", second, 10, 150);
  const past = takeFeedBatches(stock, 3, first);
  assert.equal(past.uncosted, 3);
  assert.equal(past.valueCents, 0);
  const shortage = takeFeedBatches(stock, 13, second);
  assert.equal(shortage.uncosted, 3);
  assert.equal(shortage.valueCents, 15000);
});
test("repeat purchase IDs are idempotent and conflicting reuse is refused", () => {
  const stock = addFeedBatch([], "invoice", first, 10, 100);
  assert.deepEqual(addFeedBatch(stock, "invoice", first, 10, 100), stock);
  assert.throws(() => addFeedBatch(stock, "invoice", first, 10, 150));
  for (const quantity of [NaN, Infinity, -1, 0])
    assert.throws(() => addFeedBatch([], "bad", first, quantity, 100));
  assert.throws(() => takeFeedBatches(stock, -1, first));
  assert.throws(() => addFeedBatch([], "bad", "invalid", 1, 10));
});
