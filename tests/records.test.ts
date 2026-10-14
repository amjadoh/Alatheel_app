import { test } from "node:test";
import assert from "node:assert/strict";
import { storageCollection, normalizeRecord } from "../functions/src/records";
test("mobile income uses the original stable incomes collection", () =>
  assert.equal(storageCollection("income"), "incomes"));
test("legacy Firestore timestamps and billing dates normalize without changing stored data", () => {
  const stamp = { toDate: () => new Date("2026-10-14T12:00:00Z") };
  const original = { collectedAt: stamp, dueDate: stamp, amount: 2700 };
  const row = normalizeRecord("income", "i", original);
  assert.equal(row.dueDate, "2026-10-14");
  assert.equal(row.collectedAt, "2026-10-14T12:00:00.000Z");
  assert.equal(original.dueDate, stamp);
});
