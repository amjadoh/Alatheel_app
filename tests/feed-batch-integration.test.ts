import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCommand, emptyState, type State } from "../functions/src/domain";
import { consumeScheduledFeeding } from "../functions/src/feeding-stock";
import { financialSummary } from "../functions/src/finance";
import { horseCost } from "../functions/src/estimates";
import { batchStockValue } from "../functions/src/feed-valuation";
const actor = { uid: "admin", role: "admin" as const, displayName: "مدير" };
let seq = 0;
const run = (
  s: State,
  action: string,
  data: any,
  day: string,
  id = "feed",
  requestId = "batch_test_" + ++seq,
) =>
  applyCommand(s, actor, { action, id, data, requestId }, day + "T12:00:00Z");
function initial() {
  const s = emptyState();
  s.mealTypes = [
    {
      id: "feed",
      name: "شعير",
      unit: "كجم",
      feedingUnit: "كجم",
      feedingUnitsPerPurchaseUnit: 1,
      pricePerUnit: 0,
      currentStock: 0,
      minThreshold: 1,
    },
  ];
  s.horses = [
    {
      id: "horse",
      name: "خيل",
      status: "private",
      entryDate: "2026-10-25",
      feeding: [{ mealTypeId: "feed", quantity: 1, frequency: "daily" }],
    },
  ];
  return s;
}
function example() {
  let s = run(
    initial(),
    "stock.purchase",
    { amount: 10, total: 100, paidAt: "2026-10-24", method: "cash" },
    "2026-10-24",
  );
  s = run(
    s,
    "stock.reconcile",
    { actualQuantity: 10, activate: true, reason: "تأكيد الرصيد" },
    "2026-10-24",
  );
  s = run(
    s,
    "stock.purchase",
    { amount: 10, total: 150, paidAt: "2026-11-01", method: "cash" },
    "2026-11-01",
  );
  return s;
}
test("invoice to FIFO to horse report: 70 consumed, 180 remaining, then 60 consumed and 120 remaining; old month frozen", () => {
  let s = example();
  assert.equal(s.mealTypes[0].currentStock, 13);
  assert.equal(batchStockValue(s.mealTypes[0]).value, 180);
  assert.equal(financialSummary(s, "2026-10").feeding, 70);
  const october = structuredClone(financialSummary(s, "2026-10"));
  s = consumeScheduledFeeding(s, "2026-11-05", "2026-11-06T12:00:00Z");
  assert.equal(horseCost(s, s.horses[0], "2026-11").food, 60);
  assert.equal(s.mealTypes[0].currentStock, 8);
  assert.equal(batchStockValue(s.mealTypes[0]).value, 120);
  assert.equal(s.expenses.length, 2);
  assert.equal(s.expensePayments.length, 2);
  assert.equal(
    s.expensePayments.reduce((n, p) => n + p.amount, 0),
    250,
  );
  assert.deepEqual(financialSummary(s, "2026-10"), october);
  assert.deepEqual(consumeScheduledFeeding(s, "2026-11-05"), s);
});
test("skipping a consumed meal returns its original price and lot exactly once without paying again", () => {
  let s = consumeScheduledFeeding(
    example(),
    "2026-11-05",
    "2026-11-06T12:00:00Z",
  );
  s = run(
    s,
    "feeding.skip",
    { mealTypeId: "feed", date: "2026-11-01", reason: "لم تقدم الوجبة" },
    "2026-11-06",
    "horse",
    "skip_original",
  );
  assert.equal(horseCost(s, s.horses[0], "2026-11").food, 50);
  assert.equal(s.mealTypes[0].currentStock, 9);
  assert.equal(batchStockValue(s.mealTypes[0]).value, 130);
  assert.deepEqual(
    run(
      s,
      "feeding.skip",
      { mealTypeId: "feed", date: "2026-11-01", reason: "لم تقدم الوجبة" },
      "2026-11-06",
      "horse",
      "skip_original",
    ),
    s,
  );
});
test("invoice correction preserves closed horse cost and records only its historical difference now", () => {
  let s = consumeScheduledFeeding(
    example(),
    "2026-11-05",
    "2026-11-06T12:00:00Z",
  );
  const october = structuredClone(financialSummary(s, "2026-10")),
    purchase = s.inventoryTransactions.find(
      (t) => t.movementKind === "purchase",
    )!;
  s = run(
    s,
    "stock.purchase.correct",
    {
      amount: 10,
      total: 120,
      reason: "تصحيح السعر",
      expectedCorrectionId: purchase.id,
    },
    "2026-11-06",
    purchase.id,
  );
  assert.deepEqual(financialSummary(s, "2026-10"), october);
  assert.equal(horseCost(s, s.horses[0], "2026-11").food, 80);
  assert.equal(batchStockValue(s.mealTypes[0]).value, 120);
  s = run(
    s,
    "feeding.skip",
    { mealTypeId: "feed", date: "2026-11-01", reason: "لم تقدم الوجبة" },
    "2026-11-06",
    "horse",
  );
  assert.equal(horseCost(s, s.horses[0], "2026-11").food, 68);
  assert.equal(batchStockValue(s.mealTypes[0]).value, 132);
});
test("same supplier invoice blocks duplicate purchases, while retries cannot repeat stock or payment", () => {
  const data = {
    amount: 10,
    total: 100,
    paidAt: "2026-10-24",
    method: "cash",
    supplier: "المورد",
    invoiceNumber: "123",
  };
  const s = run(
    initial(),
    "stock.purchase",
    data,
    "2026-10-24",
    "feed",
    "original_invoice",
  );
  assert.deepEqual(
    run(s, "stock.purchase", data, "2026-10-24", "feed", "original_invoice"),
    s,
  );
  assert.throws(
    () => run(s, "stock.purchase", data, "2026-10-24"),
    /الفاتورة مسجلة/,
  );
});
test("old unvalued stock remains incomplete, opening valuation adds no cash and preserves all prior days", () => {
  const seed = initial();
  seed.mealTypes[0].currentStock = 3;
  seed.mealTypes[0].pricePerUnit = 10;
  let s = run(
    seed,
    "stock.purchase",
    { amount: 10, total: 150, paidAt: "2026-11-01", method: "cash" },
    "2026-11-01",
  );
  assert.equal(batchStockValue(s.mealTypes[0]).unvalued, 3);
  const old = horseCost(s, s.horses[0], "2026-10");
  s = run(
    s,
    "stock.value",
    {
      batchId: "opening_feed",
      expectedQuantity: 3,
      quantity: 3,
      total: 30,
      receivedAt: "2026-10-24",
      reason: "الفاتورة الأصلية",
    },
    "2026-11-01",
  );
  assert.equal(s.expenses.length, 1);
  assert.equal(s.expensePayments.length, 1);
  assert.equal(batchStockValue(s.mealTypes[0]).value, 180);
  assert.deepEqual(horseCost(s, s.horses[0], "2026-10"), old);
});

test("a later expensive invoice never changes an already recorded horse portion", () => {
  let s = consumeScheduledFeeding(
    example(),
    "2026-11-05",
    "2026-11-06T12:00:00Z",
  );
  const cost = horseCost(s, s.horses[0], "2026-11").food;
  s = run(
    s,
    "stock.purchase",
    { amount: 10, total: 700, paidAt: "2026-11-06", method: "cash" },
    "2026-11-06",
  );
  assert.equal(horseCost(s, s.horses[0], "2026-11").food, cost);
  assert.equal(batchStockValue(s.mealTypes[0]).value, 820);
});
test("daily portions across horses keep their lot prices in deterministic order", () => {
  let s = example();
  s.horses = [
    {
      ...s.horses[0],
      id: "b",
      feedingHistory: [],
      entryDate: "2026-11-01",
      feeding: [{ mealTypeId: "feed", quantity: 3, frequency: "daily" }],
    },
    {
      ...s.horses[0],
      id: "a",
      feedingHistory: [],
      entryDate: "2026-11-01",
      feeding: [{ mealTypeId: "feed", quantity: 2, frequency: "daily" }],
    },
  ];
  s = consumeScheduledFeeding(s, "2026-11-01", "2026-11-02T00:00:00Z");
  assert.equal(
    horseCost(
      s,
      s.horses.find((h) => h.id === "a")!,
      "2026-11",
    ).food,
    20,
  );
  assert.equal(
    horseCost(
      s,
      s.horses.find((h) => h.id === "b")!,
      "2026-11",
    ).food,
    40,
  );
  assert.equal(batchStockValue(s.mealTypes[0]).value, 120);
});
test("purchase bags convert to feeding kilos before valuing the portion", () => {
  const seed = initial();
  Object.assign(seed.mealTypes[0], {
    unit: "كيس 40 كجم",
    feedingUnitsPerPurchaseUnit: 40,
  });
  seed.horses[0].entryDate = "2026-10-24";
  seed.horses[0].feeding[0].quantity = 5;
  let s = run(
    seed,
    "stock.purchase",
    { amount: 1, total: 80, paidAt: "2026-10-24", method: "cash" },
    "2026-10-24",
  );
  s.mealTypes[0].autoFeedingFrom = "2026-10-24";
  s = consumeScheduledFeeding(s, "2026-10-24", "2026-10-25T00:00:00Z");
  assert.equal(horseCost(s, s.horses[0], "2026-10").food, 10);
  assert.equal(s.mealTypes[0].currentStock, 0.875);
  assert.equal(batchStockValue(s.mealTypes[0]).value, 70);
});
test("a physical count clears a shortage without creating a phantom unvalued batch", () => {
  const seed = initial();
  seed.mealTypes[0].currentStock = -3;
  seed.mealTypes[0].feedBatches = [];
  seed.mealTypes[0].batchCostFrom = "2026-10-24";
  const s = run(
    seed,
    "stock.reconcile",
    { actualQuantity: 0, activate: true, reason: "جرد فعلي صفر" },
    "2026-10-24",
  );
  assert.equal(s.mealTypes[0].currentStock, 0);
  assert.deepEqual(s.mealTypes[0].feedBatches, []);
});
test("stock units cannot change after purchase, and manual feed expenses cannot duplicate an invoice", () => {
  const s = example(),
    meal = s.mealTypes[0];
  assert.throws(
    () =>
      run(
        s,
        "meal.save",
        { ...meal, unit: "كيس", feedingUnitsPerPurchaseUnit: 40 },
        "2026-11-01",
      ),
    /لا يمكن تغيير وحدة/,
  );
  assert.throws(
    () =>
      run(
        s,
        "expense.save",
        {
          name: "شراء شعير",
          expenseKind: "feed_purchase",
          cost: 150,
          frequency: "once",
          incurredAt: "2026-11-01",
          mealTypeId: "feed",
        },
        "2026-11-01",
        "",
      ),
    /شراء العلف يسجل/,
  );
});
