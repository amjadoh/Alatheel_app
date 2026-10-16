import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyCommand,
  emptyState,
  type State,
  type Actor,
} from "../functions/src/domain";
import { financialSummary, horseFinance } from "../functions/src/finance";
import { horseAccount, accountRevision } from "../functions/src/accounts";
import { stayDays, boardingAmount } from "../functions/src/boarding";
const admin: Actor = { uid: "admin", role: "admin", displayName: "مدير" };
let seq = 0;
function seed() {
  const s = emptyState();
  s.owners = [{ id: "o", displayName: "مالك" }];
  s.mealTypes = [
    {
      id: "feed",
      name: "علف",
      unit: "كجم",
      pricePerUnit: 2,
      currentStock: 0,
      minThreshold: 0,
    },
  ];
  s.horses = [
    {
      id: "h",
      name: "خيل",
      ownerId: "o",
      status: "boarding",
      entryDate: "2026-09-01",
      dueDate: "2026-09-01",
      boardingFee: 700,
      feeding: [{ mealTypeId: "feed", quantity: 3 }],
    },
  ];
  s.expenses = [
    {
      id: "salary",
      name: "راتب",
      frequency: "monthly",
      cost: 100,
      allocationScope: "all_active",
    },
  ];
  return s;
}
const run = (
  s: State,
  day: string,
  action = "finance.rollover",
  id?: string,
  data?: any,
) =>
  applyCommand(
    s,
    admin,
    { action, id, data, requestId: "period_" + ++seq },
    day + "T10:00:00Z",
  );
test("rollover freezes every financial figure and source price before the first next-month mutation", () => {
  let s = run(seed(), "2026-09-15");
  const before = financialSummary(s, "2026-09");
  s = run(s, "2026-10-02", "meal.save", "feed", {
    ...s.mealTypes[0],
    pricePerUnit: 3,
  });
  assert.deepEqual(financialSummary(s, "2026-09"), before);
  assert.equal(
    s.financialPeriods.find((p) => p.id === "2026-09")!.basis.mealTypes[0]
      .pricePerUnit,
    2,
  );
  assert.equal(financialSummary(s, "2026-10").feeding, 279);
  assert.equal(financialSummary(s, "2026-09").feeding, 180);
  assert.equal(
    s.financialPeriods.find((p) => p.id === "2026-09")!.closed,
    true,
  );
  const frozen = structuredClone(s.financialPeriods[0]);
  s = run(s, "2026-10-03", "horse.checkout", "h", {
    exitDate: "2026-10-03",
    exitReason: "customer_request",
  });
  assert.deepEqual(financialSummary(s, "2026-09"), before);
  assert.deepEqual(s.financialPeriods[0], frozen);
  assert.deepEqual(horseFinance(s, s.horses[0], "2026-09"), before.horses[0]);
});
test("month freezes from latest saved configuration, expenses, fee and program; open month remains editable", () => {
  let s = run(seed(), "2026-09-15");
  s = run(s, "2026-09-16", "horse.save", "h", {
    ...s.horses[0],
    boardingFee: 800,
    feeding: [{ mealTypeId: "feed", quantity: 4 }],
  });
  s = run(s, "2026-09-17", "expense.save", "salary", {
    ...s.expenses[0],
    cost: 120,
  });
  const before = financialSummary(s, "2026-09");
  assert.equal(before.expected, 800);
  assert.equal(before.feeding, 240);
  s = run(s, "2026-10-02", "expense.delete", "salary");
  assert.deepEqual(financialSummary(s, "2026-09"), before);
  assert.equal(financialSummary(s, "2026-10").other, 0);
});
test("idle months close with their own calendar days, then repeat rollover is idempotent", () => {
  let s = run(seed(), "2026-09-15");
  s = run(s, "2026-12-02");
  assert.equal(financialSummary(s, "2026-09").feeding, 180);
  assert.equal(financialSummary(s, "2026-10").feeding, 186);
  assert.equal(financialSummary(s, "2026-11").feeding, 180);
  const previous = JSON.stringify(s.financialPeriods.filter((p) => p.closed));
  s = run(s, "2026-12-03");
  assert.equal(
    JSON.stringify(s.financialPeriods.filter((p) => p.closed)),
    previous,
  );
});
test("a receipt for closed-month arrears belongs to current cash and leaves closed statement unchanged", () => {
  let s = run(seed(), "2026-09-15");
  s = run(s, "2026-10-02");
  const before = financialSummary(s, "2026-09");
  const data = {
    paymentType: "arrears",
    periods: ["2026-09"],
    amount: 350,
    paidAt: "2026-10-02",
    method: "bank",
    expectedRevision: accountRevision(s, s.horses[0]),
  };
  s = run(s, "2026-10-02", "income.pay", "h", data);
  assert.deepEqual(financialSummary(s, "2026-09"), before);
  assert.equal(financialSummary(s, "2026-10").collected, 350);
  assert.equal(horseAccount(s, s.horses[0], "2026-10-02").arrears, 350);
  assert.throws(
    () =>
      run(s, "2026-10-03", "income.pay", "h", {
        ...data,
        paidAt: "2026-09-30",
        expectedRevision: accountRevision(s, s.horses[0]),
      }),
    /مغلق/,
  );
});
test("closed period rejects backdated exits, entry changes and one-off expenses", () => {
  let s = run(seed(), "2026-09-15");
  s = run(s, "2026-10-02");
  assert.throws(
    () =>
      run(s, "2026-10-03", "horse.checkout", "h", {
        exitDate: "2026-09-30",
        exitReason: "customer_request",
      }),
    /مغلق/,
  );
  assert.throws(
    () =>
      run(s, "2026-10-03", "horse.save", "h", {
        ...s.horses[0],
        entryDate: "2026-09-02",
      }),
    /مغلق/,
  );
  assert.throws(
    () =>
      run(s, "2026-10-03", "expense.save", undefined, {
        name: "صيانة",
        cost: 100,
        frequency: "once",
        allocationScope: "all_active",
        chargedTo: "stable",
        incurredAt: "2026-09-30",
      }),
    /مغلق/,
  );
});
test("calendar-day boarding includes entry and exit, handles leap February and preserves full-month option", () => {
  const h = {
    id: "h",
    entryDate: "2024-02-15",
    exitDate: "2024-02-29",
    boardingFee: 290,
    billingPolicy: "per_day",
  };
  assert.equal(stayDays(h, "2024-02"), 15);
  assert.equal(boardingAmount(h, "2024-02"), 150);
  assert.equal(
    boardingAmount({ ...h, billingPolicy: "full_month" }, "2024-02"),
    290,
  );
  assert.equal(boardingAmount(h, "2024-03"), 0);
  assert.equal(stayDays(h, "2024-01"), 0);
});
test("daily policy entry starts accrual at entry and checkout preserves excess payment as credit", () => {
  let s = seed();
  s.horses = [];
  s = run(s, "2026-10-16", "horse.save", undefined, {
    name: "خيل",
    ownerId: "o",
    status: "boarding",
    entryDate: "2026-10-16",
    dueDate: "2026-11-16",
    boardingFee: 310,
    billingPolicy: "per_day",
    feeding: [{ mealTypeId: "feed", quantity: 3 }],
  });
  const id = s.horses[0].id;
  assert.equal(s.horses[0].dueDate, "2026-10-16");
  assert.equal(horseFinance(s, s.horses[0], "2026-10").expected, 160);
  assert.equal(horseFinance(s, s.horses[0], "2026-10").food, 96);
  s = run(s, "2026-10-16", "income.pay", id, {
    paymentType: "monthly",
    amount: 160,
    paidAt: "2026-10-16",
    method: "bank",
    expectedRevision: accountRevision(s, s.horses[0]),
  });
  s = run(s, "2026-10-20", "horse.checkout", id, {
    exitDate: "2026-10-20",
    exitReason: "customer_request",
  });
  const a = horseAccount(s, s.horses[0], "2026-10-20");
  assert.equal(a.outstanding, 0);
  assert.equal(a.credit, 110);
  assert.equal(a.charged, 50);
  assert.equal(a.paid, 160);
  assert.equal(horseFinance(s, s.horses[0], "2026-10").food, 30);
});
test("overdue, current due and upcoming sum to total, after partial and advance allocation", () => {
  const s = seed();
  s.horses[0].dueDate = "2026-09-20";
  let a = horseAccount(s, s.horses[0], "2026-10-16");
  assert.deepEqual([a.arrears, a.dueNow, a.upcoming], [700, 0, 700]);
  a = horseAccount(s, s.horses[0], "2026-10-20");
  assert.deepEqual([a.arrears, a.dueNow, a.upcoming], [700, 700, 0]);
  assert.equal(a.outstanding, a.arrears + a.dueNow + a.upcoming);
});
test("financial periods contain no photos and are hidden from owners; invalid policies are rejected", async () => {
  const { visibleState } = await import("../functions/src/domain");
  const s = seed();
  s.horses[0].photoURL = "data:image/jpeg;base64,YWJj";
  const out = run(s, "2026-09-15");
  assert.equal(
    JSON.stringify(out.financialPeriods).includes("photoURL"),
    false,
  );
  assert.deepEqual(
    visibleState(out, { uid: "o", role: "owner", displayName: "مالك" })
      .financialPeriods,
    [],
  );
  assert.throws(
    () =>
      run(s, "2026-09-16", "horse.save", "h", {
        ...s.horses[0],
        billingPolicy: "invalid",
      }),
    /طريقة احتساب/,
  );
});
test("return in a later month opens a new stay without changing previous closures or their source data", () => {
  let s = run(seed(), "2026-09-15");
  s.horses[0].billingPolicy = "per_day";
  s = run(s, "2026-09-20", "horse.checkout", "h", {
    exitDate: "2026-09-20",
    exitReason: "customer_request",
  });
  s = run(s, "2026-10-02");
  const frozen = structuredClone(
    s.financialPeriods.find((p) => p.id === "2026-09"),
  );
  s = run(s, "2026-10-10", "horse.restore", "h");
  assert.equal(stayDays(s.horses[0], "2026-10"), 22);
  assert.deepEqual(
    s.financialPeriods.find((p) => p.id === "2026-09"),
    frozen,
  );
  assert.equal(stayDays(s.horses[0], "2026-09"), 20);
  s = run(s, "2026-10-12", "horse.checkout", "h", {
    exitDate: "2026-10-12",
    exitReason: "customer_request",
  });
  assert.equal(stayDays(s.horses[0], "2026-10"), 3);
  assert.deepEqual(
    s.financialPeriods.find((p) => p.id === "2026-09"),
    frozen,
  );
});
test("legacy unpaid cycles retain their old rate after an open-month fee change", () => {
  let s = run(seed(), "2026-09-15");
  s = run(s, "2026-10-02", "horse.save", "h", {
    ...s.horses[0],
    boardingFee: 900,
  });
  assert.equal(horseAccount(s, s.horses[0], "2026-10-02").arrears, 700);
  assert.equal(horseFinance(s, s.horses[0], "2026-10").outstanding, 1600);
});
test("paying an older expense uses its closed-month price, independently of current price", () => {
  let s = run(seed(), "2026-09-15");
  s = run(s, "2026-10-02", "expense.save", "salary", {
    ...s.expenses[0],
    cost: 200,
  });
  const before = structuredClone(financialSummary(s, "2026-09"));
  s = run(s, "2026-10-03", "expense.pay", "salary", {
    period: "2026-09",
    paidAt: "2026-10-03",
    amount: 100,
    expectedRemaining: 100,
  });
  assert.equal(s.expensePayments[0].amount, 100);
  assert.equal(financialSummary(s, "2026-10").paid, 100);
  assert.deepEqual(financialSummary(s, "2026-09"), before);
});
test("a deleted recurring expense can still be settled for its frozen month without reactivating the recurring expense", () => {
  let s = run(seed(), "2026-09-15");
  s = run(s, "2026-10-02", "expense.delete", "salary");
  const before = structuredClone(
    s.financialPeriods.find((p) => p.id === "2026-09"),
  );
  assert.equal(s.expenses.length, 0);
  s = run(s, "2026-10-03", "expense.pay", "salary", {
    period: "2026-09",
    paidAt: "2026-10-03",
    amount: 100,
    expectedRemaining: 100,
  });
  assert.equal(s.expenses.length, 0);
  assert.equal(s.expensePayments[0].amount, 100);
  assert.equal(financialSummary(s, "2026-10").paid, 100);
  assert.equal(financialSummary(s, "2026-10").other, 0);
  assert.deepEqual(
    s.financialPeriods.find((p) => p.id === "2026-09"),
    before,
  );
});

test("late expense settlement uses the frozen name and category, while later definitions stay independent", () => {
  const base = seed();
  base.expenses[0].expenseCategory = "salary";
  let s = run(base, "2026-09-15");
  s = run(s, "2026-10-02", "expense.save", "salary", {
    ...s.expenses[0],
    name: "مصروف آخر",
    expenseCategory: "other",
    cost: 200,
  });
  const before = structuredClone(
    s.financialPeriods.find((p) => p.id === "2026-09"),
  );
  s = run(s, "2026-10-03", "expense.pay", "salary", {
    period: "2026-09",
    paidAt: "2026-10-03",
    amount: 100,
    expectedRemaining: 100,
  });
  assert.equal(s.expensePayments[0].expenseName, base.expenses[0].name);
  assert.equal(s.expensePayments[0].cashCategory, "salary");
  assert.equal(financialSummary(s, "2026-10").salaryPaid, 100);
  assert.equal(financialSummary(s, "2026-10").otherPaid, 0);
  assert.deepEqual(
    s.financialPeriods.find((p) => p.id === "2026-09"),
    before,
  );
});

test("shared salary stays allocated to horses present in the closed month after later departures", () => {
  const base = seed();
  base.horses.push({ ...base.horses[0], id: "h2" });
  let s = run(base, "2026-09-15");
  assert.equal(horseFinance(s, s.horses[0], "2026-09").other, 50);
  s = run(s, "2026-10-03", "horse.checkout", "h", {
    exitDate: "2026-10-03",
    exitReason: "customer_request",
  });
  assert.equal(horseFinance(s, s.horses[0], "2026-09").other, 50);
  assert.equal(horseFinance(s, s.horses[1], "2026-09").other, 50);
  const f = financialSummary(s, "2026-09");
  assert.equal(f.total, f.feeding + f.other);
  assert.equal(f.operatingBalance, f.revenue - f.total);
  assert.equal(f.cashBalance, f.collected - f.paid);
  assert.equal(
    f.outstanding,
    f.horses.reduce((n, h) => n + h.outstanding, 0),
  );
});
test("rejected backdated financial operations leave input receipts and monthly records untouched", () => {
  let s = run(seed(), "2026-09-15");
  s = run(s, "2026-10-02");
  const before = JSON.stringify(s);
  assert.throws(() =>
    run(s, "2026-10-02", "horse.checkout", "h", {
      exitDate: "2026-09-10",
      exitReason: "customer_request",
    }),
  );
  assert.equal(JSON.stringify(s), before);
});
