import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyCommand,
  emptyState,
  type Actor,
  type State,
} from "../functions/src/domain";
import { accountRevision, horseAccount } from "../functions/src/accounts";
import { expensePaid, financialSummary } from "../functions/src/finance";
const actor: Actor = { uid: "admin", role: "admin", displayName: "مدير" };
const now = "2026-10-16T10:00:00Z";
let sequence = 0;
function run(s: State, action: string, id?: string, data?: any) {
  return applyCommand(
    s,
    actor,
    { action, id, data, requestId: "recovery_" + ++sequence },
    now,
  );
}
function seed() {
  const s = emptyState();
  s.owners = [{ id: "owner", displayName: "مالك" }];
  s.horses = [
    {
      id: "horse",
      name: "خيل",
      ownerId: "owner",
      status: "boarding",
      boardingFee: 1000,
      entryDate: "2026-10-01",
      dueDate: "2026-10-01",
      feeding: [],
    },
  ];
  return run(s, "expense.save", undefined, {
    name: "زيارة طبيب",
    cost: 300,
    frequency: "once",
    incurredAt: "2026-10-16",
    expenseKind: "operating",
    expenseCategory: "other",
    allocationScope: "selected",
    horseIds: ["horse"],
    chargedTo: "owner",
  });
}
function receive(s: State, amount: number, paymentType = "partial") {
  return run(s, "income.pay", "horse", {
    amount,
    paymentType,
    paidAt: "2026-10-16",
    method: "bank",
    periods: [],
    expectedRevision: accountRevision(s, s.horses[0]),
  });
}
function payVendor(s: State, amount: number) {
  const e = s.expenses[0];
  return run(s, "expense.pay", e.id, {
    amount,
    period: "2026-10",
    paidAt: "2026-10-16",
    expectedRemaining: 300 - expensePaid(s, e.id, "2026-10"),
  });
}
test("owner collection including vet recovery never pays the vendor, even after full monthly settlement", () => {
  let s = seed();
  assert.equal(horseAccount(s, s.horses[0], "2026-10-16").outstanding, 1300);
  s = receive(s, 1300, "monthly");
  assert.equal(horseAccount(s, s.horses[0], "2026-10-16").outstanding, 0);
  assert.equal(expensePaid(s, s.expenses[0].id, "2026-10"), 0);
  let f = financialSummary(s, "2026-10");
  assert.equal(f.collected, 1300);
  assert.equal(f.paid, 0);
  assert.equal(f.unpaidExpenseCount, 1);
  assert.equal(f.cashBalance, 1300);
  const receipt = structuredClone(s.income);
  s = payVendor(s, 100);
  f = financialSummary(s, "2026-10");
  assert.equal(f.otherPaid, 100);
  assert.equal(f.unpaidExpenseCount, 1);
  assert.equal(f.cashBalance, 1200);
  assert.deepEqual(s.income, receipt);
  s = payVendor(s, 200);
  f = financialSummary(s, "2026-10");
  assert.equal(f.paid, 300);
  assert.equal(f.unpaidExpenseCount, 0);
  assert.equal(f.cashBalance, 1000);
  assert.equal(f.total, 300);
  assert.equal(f.revenue, 1300);
  assert.equal(f.operatingBalance, 1000);
});
test("vendor payment never clears owner debt; partial owner receipts remain separate until settlement", () => {
  let s = payVendor(seed(), 300);
  assert.equal(horseAccount(s, s.horses[0], "2026-10-16").outstanding, 1300);
  assert.equal(financialSummary(s, "2026-10").cashBalance, -300);
  s = receive(s, 900);
  assert.equal(horseAccount(s, s.horses[0], "2026-10-16").outstanding, 400);
  assert.equal(financialSummary(s, "2026-10").cashBalance, 600);
  const payment = structuredClone(s.expensePayments);
  s = receive(s, 400, "monthly");
  assert.equal(horseAccount(s, s.horses[0], "2026-10-16").outstanding, 0);
  assert.equal(financialSummary(s, "2026-10").cashBalance, 1000);
  assert.deepEqual(s.expensePayments, payment);
  assert.equal(
    s.income.reduce(
      (n, r) =>
        n + r.expenseShares.reduce((v: number, x: any) => v + x.amount, 0),
      0,
    ),
    300,
  );
});
