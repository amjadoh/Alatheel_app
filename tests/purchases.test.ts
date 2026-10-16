import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyCommand,
  emptyState,
  type Actor,
  type State,
} from "../functions/src/domain";
import {
  financialSummary,
  expensePaid,
  horseFinance,
} from "../functions/src/finance";
import { itemKey, similarItems } from "../functions/src/inventory";
const admin: Actor = { uid: "admin", role: "admin", displayName: "مدير" };
let seq = 0;
function seed() {
  const s = emptyState();
  s.mealTypes = [
    {
      id: "feed",
      name: "مركزات",
      unit: "كيس 40 كجم",
      pricePerUnit: 80,
      currentStock: 5,
      minThreshold: 1,
    },
  ];
  s.owners = [{ id: "o", displayName: "مالك" }];
  s.horses = [
    {
      id: "h",
      name: "خيل",
      ownerId: "o",
      status: "boarding",
      boardingFee: 700,
      entryDate: "2026-09-01",
      dueDate: "2026-10-01",
      feeding: [{ mealTypeId: "feed", quantity: 3 }],
    },
  ];
  return s;
}
const run = (
  s: State,
  action: string,
  id?: string,
  data?: any,
  requestId = "purchase_" + ++seq,
  day = "2026-10-16",
) =>
  applyCommand(s, admin, { action, id, data, requestId }, day + "T10:00:00Z");
const data = { amount: 20, total: 1800, paidAt: "2026-10-16", method: "bank" };
test("buying the same feed atomically increases one item and registers exactly one fully paid expense", () => {
  const s = run(seed(), "stock.purchase", "feed", data);
  assert.equal(s.mealTypes.length, 1);
  assert.equal(s.mealTypes[0].currentStock, 25);
  assert.equal(s.mealTypes[0].pricePerUnit, 90);
  assert.equal(s.inventoryTransactions.length, 1);
  assert.equal(s.expenses.length, 1);
  assert.equal(s.expensePayments.length, 1);
  assert.equal(expensePaid(s, s.expenses[0].id, "2026-10"), 1800);
  assert.equal(financialSummary(s, "2026-10").inventoryPaid, 1800);
  assert.equal(financialSummary(s, "2026-10").paid, 1800);
  assert.equal(financialSummary(s, "2026-10").total, 209.25); // Food consumption only, no purchase added twice.
  assert.equal(s.inventoryTransactions[0].expenseId, s.expenses[0].id);
  assert.equal(s.inventoryTransactions[0].paymentId, s.expensePayments[0].id);
  assert.throws(
    () =>
      run(s, "expense.pay", s.expenses[0].id, {
        period: "2026-10",
        paidAt: "2026-10-16",
        amount: 1800,
        expectedRemaining: 1800,
      }),
    /مسدد بالكامل/,
  );
});
test("ambiguous retry with the same request id cannot repeat purchase, quantity or spending", () => {
  const s = run(
    seed(),
    "stock.purchase",
    "feed",
    data,
    "purchase_same_receipt",
  );
  assert.deepEqual(
    run(s, "stock.purchase", "feed", data, "purchase_same_receipt"),
    s,
  );
  assert.equal(financialSummary(s, "2026-10").paid, 1800);
});
test("separate invoices with different prices stay on the same feed id and retain their actual amounts", () => {
  let s = run(seed(), "stock.purchase", "feed", data);
  s = run(s, "stock.purchase", "feed", { ...data, amount: 10, total: 950 });
  assert.equal(s.mealTypes.length, 1);
  assert.equal(s.mealTypes[0].currentStock, 35);
  assert.equal(s.mealTypes[0].pricePerUnit, 95);
  assert.deepEqual(
    s.expenses.map((e) => e.cost),
    [1800, 950],
  );
  assert.equal(financialSummary(s, "2026-10").paid, 2750);
  assert.equal(s.inventoryTransactions[0].unitPrice, 90);
});
test("new invoice covers recurring purchase plan instead of doubling the purchase commitment", () => {
  const base = seed();
  base.expenses = [
    {
      id: "budget",
      name: "مركزات",
      mealTypeId: "feed",
      expenseKind: "feed_purchase",
      frequency: "monthly",
      cost: 1800,
    },
  ];
  const s = run(base, "stock.purchase", "feed", data);
  assert.equal(financialSummary(s, "2026-10").purchases, 1800);
  assert.equal(financialSummary(s, "2026-10").inventoryPaid, 1800);
  assert.throws(
    () =>
      run(s, "expense.pay", "budget", {
        period: "2026-10",
        paidAt: "2026-10-16",
        amount: 1800,
        expectedRemaining: 1800,
      }),
    /مرة ثانية/,
  );
});
test("unpaid vet cost affects operating cost and owner charge when chosen, then affects cash only when actually paid", () => {
  let s = run(seed(), "expense.save", undefined, {
    name: "طبيب",
    cost: 300,
    frequency: "once",
    incurredAt: "2026-10-16",
    allocationScope: "selected",
    horseIds: ["h"],
    chargedTo: "stable",
    expenseCategory: "other",
    expenseKind: "operating",
  });
  const e = s.expenses[0];
  assert.equal(financialSummary(s, "2026-10").otherPaid, 0);
  assert.equal(financialSummary(s, "2026-10").other, 300);
  assert.equal(horseFinance(s, s.horses[0], "2026-10").outstanding, 700); // Vet not charged to owner without explicit choice.
  s = run(s, "expense.pay", e.id, {
    period: "2026-10",
    paidAt: "2026-10-16",
    amount: 100,
    expectedRemaining: 300,
  });
  assert.equal(financialSummary(s, "2026-10").otherPaid, 100);
  assert.equal(financialSummary(s, "2026-10").paid, 100);
});
test("cash breakdown reconciles exactly with receipts, salary, inventory and other payments", () => {
  let s = run(seed(), "stock.purchase", "feed", data);
  s.income.push({
    id: "receipt",
    horseId: "h",
    collectedAt: "2026-10-16T09:00:00Z",
    amount: 4000,
    status: "collected",
    dueDate: "2026-10-01",
  });
  for (const [name, cost, expenseCategory] of [
    ["راتب العامل", 1800, "salary"],
    ["طبيب", 300, "other"],
  ] as const) {
    s = run(s, "expense.save", undefined, {
      name,
      cost,
      frequency: "once",
      incurredAt: "2026-10-16",
      expenseKind: "operating",
      expenseCategory,
      allocationScope: "all_active",
      chargedTo: "stable",
    });
    s = run(s, "expense.pay", s.expenses.at(-1)!.id, {
      period: "2026-10",
      paidAt: "2026-10-16",
      amount: cost,
      expectedRemaining: cost,
    });
  }
  const f = financialSummary(s, "2026-10");
  assert.equal(f.inventoryPaid, 1800);
  assert.equal(f.salaryPaid, 1800);
  assert.equal(f.otherPaid, 300);
  assert.equal(f.paid, 3900);
  assert.equal(f.collected, 4000);
  assert.equal(f.cashBalance, 100);
  assert.equal(f.paid, f.inventoryPaid + f.salaryPaid + f.otherPaid);
});
test("stock corrections and consumption do not create a purchase or a cash payment", () => {
  let s = run(seed(), "stock.move", "feed", {
    type: "add",
    amount: 2,
    reason: "تصحيح جرد",
  });
  s = run(s, "stock.move", "feed", {
    type: "remove",
    amount: 1,
    reason: "استهلاك",
  });
  assert.equal(s.mealTypes[0].currentStock, 6);
  assert.equal(s.expenses.length, 0);
  assert.equal(s.expensePayments.length, 0);
});
test("invalid and closed-month purchases are atomic failures; future dates and owner access are denied", () => {
  let s = run(
    seed(),
    "finance.rollover",
    undefined,
    undefined,
    undefined,
    "2026-09-15",
  );
  s = run(s, "finance.rollover");
  const original = JSON.stringify(s);
  for (const changed of [
    { total: 0 },
    { amount: 0 },
    { total: NaN },
    { paidAt: "2026-10-17" },
    { paidAt: "2026-09-30" },
    { method: "invalid" },
  ])
    assert.throws(() =>
      run(s, "stock.purchase", "feed", { ...data, ...changed }),
    );
  assert.equal(JSON.stringify(s), original);
  assert.throws(
    () =>
      applyCommand(
        s,
        { uid: "o", role: "owner", displayName: "مالك" },
        {
          action: "stock.purchase",
          id: "feed",
          data,
          requestId: "owner_purchase",
        },
        "2026-10-16T10:00:00Z",
      ),
    /للإدارة/,
  );
});
test("a later purchase leaves every closed month source price and total unchanged", () => {
  let s = run(
    seed(),
    "finance.rollover",
    undefined,
    undefined,
    undefined,
    "2026-09-15",
  );
  s = run(s, "finance.rollover");
  const closed = structuredClone(
    s.financialPeriods.find((p) => p.id === "2026-09"),
  );
  s = run(s, "stock.purchase", "feed", data);
  assert.deepEqual(
    s.financialPeriods.find((p) => p.id === "2026-09"),
    closed,
  );
  assert.equal(financialSummary(s, "2026-09").feeding, 180);
});
test("normalization prevents exact duplicates and close spellings require an explicit distinct-item acknowledgement", () => {
  const s = seed();
  assert.equal(itemKey(" أَعلاف  "), "اعلاف");
  assert.equal(similarItems(s.mealTypes, "مركزات").length, 1);
  assert.throws(
    () =>
      run(s, "meal.save", undefined, {
        ...s.mealTypes[0],
        name: " مُرَكَزَات ",
        currentStock: 0,
      }),
    /الصنف موجود/,
  );
  assert.throws(
    () =>
      run(s, "meal.save", undefined, {
        ...s.mealTypes[0],
        name: "مركزا",
        currentStock: 0,
      }),
    /مشابه/,
  );
  assert.equal(
    run(s, "meal.save", undefined, {
      ...s.mealTypes[0],
      name: "مركزا",
      currentStock: 0,
      confirmSimilar: true,
    }).mealTypes.length,
    2,
  );
});
