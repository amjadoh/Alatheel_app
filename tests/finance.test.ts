import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyCommand,
  emptyState,
  bill,
  Actor,
  visibleState,
} from "../functions/src/domain";
import {
  horseFinance,
  financialSummary,
  expensePaid,
} from "../functions/src/finance";
import { businessDay } from "../functions/src/dates";
import { monthlyExpense } from "../functions/src/estimates";
const admin: Actor = { uid: "admin", role: "admin", displayName: "المدير" };
const employee: Actor = {
  uid: "staff",
  role: "employee",
  displayName: "الموظف",
};
const owner: Actor = { uid: "o", role: "owner", displayName: "المالك" };
const now = "2026-10-15T12:00:00Z";
let sequence = 0;
const command = (action: string, id?: string, data?: any) => ({
  action,
  id,
  data,
  requestId: `finance_${++sequence}`,
});
function seed() {
  const s = emptyState();
  s.owners = [{ id: "o", displayName: "مالك" }];
  s.mealTypes = [
    { id: "feed", name: "مركزات", unit: "كيس 40 كجم", pricePerUnit: 90 },
  ];
  s.horses = [1, 2].map((n) => ({
    id: `h${n}`,
    name: `خيل ${n}`,
    ownerId: "o",
    status: "boarding",
    entryDate: "2026-01-01",
    dueDate: "2026-10-01",
    boardingFee: 800,
    feeding: [{ mealTypeId: "feed", quantity: 3 }],
  }));
  s.expenses = [
    {
      id: "salary",
      name: "راتب",
      cost: 600,
      frequency: "monthly",
      allocationScope: "all_active",
    },
    {
      id: "purchase",
      name: "مركزات",
      expenseKind: "feed_purchase",
      mealTypeId: "feed",
      cost: 900,
      frequency: "monthly",
    },
  ];
  return s;
}
test("dashboard separates expected operating result from actual cash and uncollected owners", () => {
  const s = seed();
  s.income = [
    {
      id: "i",
      horseId: "h1",
      dueDate: "2026-10-01",
      collectedAt: now,
      amount: 800,
      boardingFee: 800,
      status: "collected",
    },
  ];
  s.horses[0].dueDate = "2026-11-01";
  s.expensePayments = [
    {
      id: "p",
      expenseId: "salary",
      period: "2026-10",
      paidAt: "2026-10-10",
      amount: 600,
      status: "paid",
    },
  ];
  const f = financialSummary(s, "2026-10");
  assert.equal(f.expected, 1600);
  assert.equal(f.total, 1018.5);
  assert.equal(f.operatingBalance, 581.5);
  assert.equal(f.collected, 800);
  assert.equal(f.paid, 600);
  assert.equal(f.cashBalance, 200);
  assert.equal(f.outstanding, 800);
  assert.equal(f.plannedPayments, 1500); // Purchase counted in cash plan, not consumed feed twice.
  assert.equal(f.fundingBalance, 100);
  assert.equal(horseFinance(s, s.horses[0], "2026-10").margin, 290.75);
});
test("late and advance receipts use collection date for cash; selected-month outstanding includes unpaid cycles", () => {
  const s = seed();
  s.horses[0].dueDate = "2026-09-01";
  assert.equal(horseFinance(s, s.horses[0], "2026-10").outstanding, 1600);
  s.income.push({
    id: "late",
    horseId: "h1",
    boardingFee: 800,
    amount: 800,
    dueDate: "2026-09-01",
    collectedAt: "2026-11-03T00:00:00Z",
  });
  s.horses[0].dueDate = "2026-10-01";
  assert.equal(horseFinance(s, s.horses[0], "2026-10").outstanding, 1600);
  assert.equal(horseFinance(s, s.horses[0], "2026-10").cash, 0);
  assert.equal(horseFinance(s, s.horses[0], "2026-11").cash, 800);
  s.income.push({
    id: "advance",
    horseId: "h2",
    boardingFee: 800,
    amount: 800,
    dueDate: "2026-10-01",
    collectedAt: "2026-09-25T12:00:00Z",
  });
  s.horses[1].dueDate = "2026-11-01";
  assert.equal(horseFinance(s, s.horses[1], "2026-10").outstanding, 0);
  assert.equal(horseFinance(s, s.horses[1], "2026-10").cash, 0);
});
test("private horses have cost but no boarding revenue; incomplete feeding never appears as confirmed profit", () => {
  const s = seed();
  s.horses[0].status = "private";
  const f = horseFinance(s, s.horses[0], "2026-10");
  assert.equal(f.expected, 0);
  assert.equal(f.outstanding, 0);
  assert.equal(f.total, 509.25);
  s.horses[1].feeding = [];
  assert.equal(horseFinance(s, s.horses[1], "2026-10").complete, false);
  assert.equal(financialSummary(s, "2026-10").lossCount, 0);
  assert.equal(financialSummary(s, "2026-10").incompleteCount, 1);
});
test("expense payment is partial, idempotent, period-specific, rejects overpay and stale forms", () => {
  let s = seed();
  const c = command("expense.pay", "salary", {
    period: "2026-10",
    amount: 250,
    paidAt: "2026-10-10",
    expectedRemaining: 600,
  });
  s = applyCommand(s, employee, c, now);
  assert.equal(expensePaid(s, "salary", "2026-10"), 250);
  assert.equal(s.expenses[0].lockedForPayments, true);
  assert.equal(applyCommand(s, employee, c, now).expensePayments.length, 1);
  assert.throws(
    () =>
      applyCommand(
        s,
        admin,
        command("expense.pay", "salary", {
          ...c.data,
          amount: 400,
          expectedRemaining: 350,
        }),
        now,
      ),
    /يتجاوز/,
  );
  assert.throws(
    () => applyCommand(s, admin, command("expense.pay", "salary", c.data), now),
    /تغير المبلغ/,
  );
  assert.throws(
    () => applyCommand(s, owner, command("expense.pay", "salary", c.data), now),
    /للإدارة/,
  );
  s = applyCommand(
    s,
    admin,
    command("expense.pay", "salary", {
      ...c.data,
      amount: 350,
      expectedRemaining: 350,
    }),
    now,
  );
  assert.equal(expensePaid(s, "salary", "2026-10"), 600);
  assert.equal(expensePaid(s, "salary", "2026-11"), 0);
});
test("future payment dates are rejected; void requires admin and preserves its audit record", () => {
  let s = seed();
  assert.throws(
    () =>
      applyCommand(
        s,
        admin,
        command("expense.pay", "salary", {
          period: "2026-10",
          amount: 600,
          expectedRemaining: 600,
          paidAt: "2026-10-16",
        }),
        now,
      ),
    /مستقبلي/,
  );
  s = applyCommand(
    s,
    admin,
    command("expense.pay", "salary", {
      period: "2026-10",
      amount: 600,
      expectedRemaining: 600,
      paidAt: "2026-10-15",
    }),
    now,
  );
  const id = s.expensePayments[0].id;
  assert.throws(
    () =>
      applyCommand(
        s,
        employee,
        command("expense.payment.void", id, { reason: "تكرار" }),
        now,
      ),
    /للمدير/,
  );
  s = applyCommand(
    s,
    admin,
    command("expense.payment.void", id, { reason: "إدخال خاطئ" }),
    now,
  );
  assert.equal(s.expensePayments.length, 1);
  assert.equal(s.expensePayments[0].status, "void");
  assert.equal(s.expensePayments[0].voidReason, "إدخال خاطئ");
  assert.equal(financialSummary(s, "2026-10").paid, 0);
});
test("paid expense definitions cannot be silently edited or deleted", () => {
  const s = seed();
  s.expensePayments.push({
    id: "p",
    expenseId: "salary",
    period: "2026-10",
    amount: 600,
  });
  assert.throws(
    () => applyCommand(s, admin, command("expense.delete", "salary"), now),
    /بسجلات سداد/,
  );
  assert.throws(
    () =>
      applyCommand(
        s,
        admin,
        command("expense.save", "salary", s.expenses[0]),
        now,
      ),
    /مرتبط بسداد/,
  );
});
test("horse-specific cost charges owner only by explicit choice; receipts do not double-count recovery", () => {
  let s = seed();
  const data = {
    name: "علاج",
    cost: 100,
    frequency: "once",
    allocationScope: "selected",
    horseIds: ["h1"],
    expenseKind: "operating",
    chargedTo: "stable",
  };
  s = applyCommand(s, admin, command("expense.save", undefined, data), now);
  assert.equal(bill(s, s.horses[0]).amount, 800);
  assert.equal(horseFinance(s, s.horses[0], "2026-10").total, 609.25);
  s = applyCommand(
    s,
    admin,
    command("expense.save", undefined, { ...data, chargedTo: "owner" }),
    now,
  );
  assert.equal(bill(s, s.horses[0]).amount, 900);
  assert.equal(horseFinance(s, s.horses[0], "2026-10").outstanding, 900);
  const before = horseFinance(s, s.horses[0], "2026-10").margin;
  s = applyCommand(
    s,
    admin,
    command("income.collect", "h1", {
      expectedAmount: 900,
      expectedDueDate: "2026-10-01",
    }),
    now,
  );
  assert.equal(horseFinance(s, s.horses[0], "2026-10").outstanding, 0);
  assert.equal(horseFinance(s, s.horses[0], "2026-10").margin, before);
});
test("saved report is immutable and keeps original feed costs after a price change; owners cannot access staff figures", () => {
  let s = seed();
  s = applyCommand(
    s,
    admin,
    command("finance.snapshot", undefined, { month: "2026-10" }),
    now,
  );
  const cost = s.financialReports[0].summary.total;
  s.mealTypes[0].pricePerUnit = 180;
  assert.notEqual(financialSummary(s, "2026-10").total, cost);
  assert.equal(s.financialReports[0].summary.total, cost);
  assert.throws(
    () =>
      applyCommand(
        s,
        admin,
        command("finance.snapshot", undefined, { month: "2026-10" }),
        now,
      ),
    /تقرير محفوظ/,
  );
  assert.throws(
    () =>
      applyCommand(
        s,
        employee,
        command("finance.snapshot", undefined, { month: "2026-11" }),
        now,
      ),
    /للمدير/,
  );
  assert.deepEqual(visibleState(s, owner).financialReports, []);
  assert.deepEqual(visibleState(s, owner).expensePayments, []);
  assert.equal(JSON.stringify(s.financialReports).includes("photoURL"), false);
});
test("archived horse does not accrue new boarding after exit; zero and negative balances remain sane", () => {
  const s = seed();
  Object.assign(s.horses[0], {
    status: "archived",
    previousStatus: "boarding",
    exitDate: "2026-09-15",
    dueDate: "2026-10-01",
  });
  const f = horseFinance(s, s.horses[0], "2026-10");
  assert.equal(f.expected, 0);
  assert.equal(f.total, 0);
  assert.equal(f.outstanding, 0);
  assert.equal(financialSummary(emptyState(), "2026-10").operatingBalance, 0);
});
test("Riyadh midnight determines cash month; pending receipts are excluded and explicit recurrence start is honored", () => {
  assert.equal(businessDay("2026-09-30T22:00:00Z"), "2026-10-01");
  const s = seed();
  s.income = [
    {
      id: "i",
      horseId: "h1",
      amount: 800,
      collectedAt: "2026-09-30T22:00:00Z",
    },
    { id: "pending", amount: 500, status: "pending", collectedAt: now },
  ];
  assert.equal(financialSummary(s, "2026-10").collected, 800);
  assert.equal(horseFinance(s, s.horses[0], "2026-10").cash, 800);
  assert.equal(
    monthlyExpense(
      { id: "salary", cost: 1800, frequency: "monthly", startMonth: "2026-10" },
      "2026-09",
    ),
    0,
  );
});
test("only horse photo field accepts a bounded safe image and never copies owner photo", () => {
  const s = seed();
  s.owners[0].photoURL = "https://example.test/owner.jpg";
  let next = applyCommand(
    s,
    admin,
    command("horse.save", "h1", s.horses[0]),
    now,
  );
  assert.equal(next.horses[0].photoURL, "");
  next = applyCommand(
    s,
    admin,
    command("horse.save", "h1", {
      ...s.horses[0],
      photoURL: "data:image/jpeg;base64,YWJj",
    }),
    now,
  );
  assert.equal(next.horses[0].photoURL, "data:image/jpeg;base64,YWJj");
  for (const bad of [
    "javascript:alert(1)",
    "data:image/svg+xml;base64,YWJj",
    "data:image/jpeg;base64," + "a".repeat(260000),
  ])
    assert.throws(
      () =>
        applyCommand(
          s,
          admin,
          command("horse.save", "h1", { ...s.horses[0], photoURL: bad }),
          now,
        ),
      /صورة الخيل/,
    );
});
test("a backdated one-off expense and its payment are assigned to their own periods", () => {
  let s = seed();
  s = applyCommand(
    s,
    admin,
    command("expense.save", undefined, {
      name: "صيانة سابقة",
      cost: 100,
      frequency: "once",
      allocationScope: "all_active",
      chargedTo: "stable",
      incurredAt: "2026-09-15",
    }),
    now,
  );
  const e = s.expenses[s.expenses.length - 1];
  assert.equal(monthlyExpense(e, "2026-09"), 100);
  assert.equal(monthlyExpense(e, "2026-10"), 0);
  s = applyCommand(
    s,
    admin,
    command("expense.pay", e.id, {
      period: "2026-09",
      paidAt: "2026-10-15",
      amount: 100,
      expectedRemaining: 100,
    }),
    now,
  );
  assert.equal(expensePaid(s, e.id, "2026-09"), 100);
  assert.equal(financialSummary(s, "2026-09").paid, 0);
  assert.equal(financialSummary(s, "2026-10").paid, 100);
});
