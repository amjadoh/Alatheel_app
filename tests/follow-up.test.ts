import { test } from "node:test";
import assert from "node:assert/strict";
import { operationalFollowUp } from "../functions/src/follow-up";
import { applyCommand, emptyState, type State } from "../functions/src/domain";
import { accountRevision } from "../functions/src/accounts";
import { financialSummary } from "../functions/src/finance";

const today = "2026-10-21", now = today + "T12:00:00Z";
const admin = { uid: "admin", role: "admin" as const, displayName: "مدير" };
let sequence = 0;
const run = (s: State, action: string, id?: string, data?: any, at = now) =>
  applyCommand(s, admin, { action, id, data, requestId: "follow_up_" + ++sequence }, at);
function seed() {
  const s = emptyState();
  s.owners = [{ id: "owner", displayName: "مالك" }];
  s.mealTypes = [{ id: "hay", name: "رودس", unit: "ربطة", pricePerUnit: 30, currentStock: 0, minThreshold: 1 }];
  const common = { ownerId: "owner", ownerName: "مالك", status: "boarding", entryDate: "2026-10-01",
    feeding: [{ mealTypeId: "hay", quantity: .2, frequency: "daily" }] };
  s.horses = [
    { ...common, id: "late", name: "متأخر", boardingFee: 1000, dueDate: "2026-10-20" },
    { ...common, id: "today", name: "اليوم", boardingFee: 800, dueDate: today },
    { ...common, id: "advance", name: "مقدم", boardingFee: 600, dueDate: "2026-10-26" },
    { id: "private", name: "خاص", ownerId: "admin", status: "private", entryDate: "2026-10-01", feeding: [] },
  ];
  s.expenses = [{ id: "salary", name: "راتب", cost: 1800, frequency: "monthly", startMonth: "2026-10",
    expenseKind: "operating", expenseCategory: "salary", allocationScope: "all_active", chargedTo: "stable" }];
  s.registrationRequests = ["pending", "reviewing", "awaiting_owner_approval", "approved", "rejected"].map(status => ({ id: status, status, horseName: status }));
  return s;
}
function receipt(s: State, horseId: string, amount: number) {
  return run(s, "income.pay", horseId, { amount, paymentType: "partial", paidAt: today, method: "bank",
    expectedRevision: accountRevision(s, s.horses.find(h => h.id === horseId)!) });
}
function operated() {
  let s = seed();
  s.expenses.push({ id: "vet", name: "طبيب", cost: 300, frequency: "once", incurredAt: today,
    expenseKind: "operating", expenseCategory: "other", allocationScope: "selected", chargedTo: "owner", horseIds: ["late"], allocations: { late: 300 } });
  s = run(s, "stock.purchase", "hay", { amount: 7, total: 210, paidAt: today, method: "bank" });
  s = run(s, "expense.pay", "salary", { amount: 600, period: "2026-10", paidAt: today, expectedRemaining: 1800 });
  s = run(s, "expense.pay", "vet", { amount: 100, period: "2026-10", paidAt: today, expectedRemaining: 300 });
  s = receipt(s, "late", 250);
  return receipt(s, "advance", 1000);
}

test("today actions use remaining partial balances and omit fully prepaid and private horses", () => {
  const result = operationalFollowUp(operated(), today);
  assert.equal(result.collectionTotals.overdue, 750);
  assert.equal(result.collectionTotals.dueToday, 1100); // 800 boarding + 300 recoverable vet.
  assert.equal(result.collectionTotals.upcoming, 0);
  assert.deepEqual(result.collections.overdue.map(row => row.horseId), ["late"]);
  assert.equal(result.collections.dueToday.find(row => row.horseId === "late")!.extras, 300);
  assert.ok(!Object.values(result.collections).flat().some(row => ["advance", "private"].includes(row.horseId)));
  assert.equal(result.pendingRequests.length, 3);
});

test("forecast separates real cash, future owner balances and unpaid vendor amounts", () => {
  const result = operationalFollowUp(operated(), today).forecast;
  assert.deepEqual(result.actual, { collected: 1250, paid: 910, net: 340 });
  assert.equal(result.receivables.total, 1850);
  assert.equal(result.receivables.boarding, 1550); assert.equal(result.receivables.extras, 300);
  assert.equal(result.payables.total, 1400);
  assert.equal(result.payables.rows.find(row => row.expenseId === "salary")!.remaining, 1200);
  assert.equal(result.payables.rows.find(row => row.expenseId === "vet")!.remaining, 200);
  assert.equal(result.projectedMovement, 790);
  assert.equal(result.end, "2026-10-31"); assert.equal(result.inventoryNeedsExcluded, true);
});

test("recurring feed budget and paid inventory invoice never become a second payable", () => {
  const s = operated();
  s.expenses.push({ id: "feed-budget", name: "رودس", expenseKind: "feed_purchase", mealTypeId: "hay", frequency: "monthly", cost: 900 });
  const result = operationalFollowUp(s, today).forecast;
  assert.equal(result.excludedFeedBudget, 900);
  assert.equal(result.actual.paid, 910); assert.equal(result.payables.total, 1400);
  assert.ok(!result.payables.rows.some(row => row.expenseId.includes("purchase") || row.expenseId === "feed-budget"));
  assert.equal(result.projectedMovement, 790);
});

test("future receipts and provider payments cannot reduce today's balances or inflate actual cash", () => {
  const s = operated();
  s.income.push({ id: "future", horseId: "today", amount: 800, accountVersion: 1, status: "collected", collectedAt: "2026-10-30T12:00:00Z",
    allocations: [{ id: "boarding_2026-10-21", amount: 800 }] });
  s.expensePayments.push({ id: "future-pay", expenseId: "salary", amount: 1200, period: "2026-10", paidAt: "2026-10-30", status: "paid" });
  const result = operationalFollowUp(s, today).forecast;
  assert.equal(result.actual.collected, 1250); assert.equal(result.actual.paid, 910);
  assert.equal(result.receivables.total, 1850); assert.equal(result.payables.total, 1400);
});

test("pending and void records never enter cash or settle outstanding balances", () => {
  const s = operated();
  for (const status of ["pending", "void"]) s.income.push({ id: status, horseId: "today", amount: 800, accountVersion: 1, status, collectedAt: now,
    allocations: [{ id: "boarding_2026-10-21", amount: 800 }] });
  s.expensePayments.push({ id: "void-pay", expenseId: "salary", amount: 1200, period: "2026-10", paidAt: today, status: "void" });
  const result = operationalFollowUp(s, today).forecast;
  assert.deepEqual(result.actual, { collected: 1250, paid: 910, net: 340 });
  assert.equal(result.receivables.total, 1850); assert.equal(result.payables.total, 1400);
});

test("owner paying a recoverable vet amount never settles the provider, and provider settlement never clears owner debt", () => {
  const base = operated(), providerPaid = run(base, "expense.pay", "vet", { amount: 200, period: "2026-10", paidAt: today, expectedRemaining: 200 });
  assert.equal(operationalFollowUp(providerPaid, today).forecast.receivables.extras, 300);
  assert.equal(operationalFollowUp(providerPaid, today).forecast.payables.total, 1200);
  const ownerPaid = receipt(base, "late", 1050); // Remaining750 boarding +300 vet.
  assert.equal(operationalFollowUp(ownerPaid, today).forecast.receivables.extras, 0);
  assert.equal(operationalFollowUp(ownerPaid, today).forecast.payables.rows.find(row => row.expenseId === "vet")!.remaining, 200);
});

test("older arrears are identified separately and later-month receipts do not hide them", () => {
  const s = seed(); s.horses = [s.horses[0]];
  Object.assign(s.horses[0], { entryDate: "2026-09-01", accountAnchor: "2026-09-20", dueDate: "2026-09-20", accountVersion: 1 });
  s.income = [{ id: "partial", horseId: "late", amount: 250, accountVersion: 1, collectedAt: now, status: "collected",
    allocations: [{ id: "boarding_2026-09-20", amount: 250 }] }];
  const result = operationalFollowUp(s, today).forecast;
  assert.equal(result.receivables.priorMonthArrears, 750);
  assert.equal(result.receivables.overdueThisMonth, 1000);
  assert.equal(result.receivables.total, 1750); assert.equal(result.actual.collected, 250);
});

test("prior payables use closed prices even after salary change or deletion and subtract later partial settlements", () => {
  let s = seed();
  s.expenses[0].startMonth = "2026-09";
  s = run(s, "finance.rollover", undefined, undefined, "2026-09-21T12:00:00Z");
  s = run(s, "expense.save", "salary", { ...s.expenses[0], cost: 2400 }, now);
  const frozen = structuredClone(s.financialPeriods.find(period => period.id === "2026-09"));
  s = run(s, "expense.pay", "salary", { amount: 500, period: "2026-09", paidAt: today, expectedRemaining: 1800 });
  const result = operationalFollowUp(s, today).forecast;
  assert.equal(result.payables.rows.find(row => row.period === "2026-09")!.planned, 1800);
  assert.equal(result.payables.priorPeriods, 1300); assert.equal(result.payables.currentMonth, 2400);
  assert.equal(result.actual.paid, 500);
  s.expenses = []; // A historical bill may remain after its definition is no longer active.
  assert.equal(operationalFollowUp(s, today).forecast.payables.total, 1300);
  assert.deepEqual(s.financialPeriods.find(period => period.id === "2026-09"), frozen);
});

test("missing historical bases are disclosed instead of inventing recurring old-price liabilities", () => {
  const s = seed(); s.expenses[0].startMonth = "2026-08";
  const result = operationalFollowUp(s, today);
  assert.deepEqual(result.forecast.missingHistoricalPeriods, ["2026-08", "2026-09"]);
  assert.equal(result.forecast.payables.total, 1800); assert.equal(result.forecast.payables.priorPeriods, 0);
  assert.equal(result.forecast.complete, false);
  assert.ok(result.observations.some(item => item.code === "payable_history_incomplete"));
});

test("dated old one-off bills remain known without inventing old recurring salary", () => {
  const s = seed();
  s.expenses.push({ id: "old-vet", name: "طبيب سابق", cost: 200, frequency: "once", incurredAt: "2026-09-02", expenseKind: "operating", chargedTo: "stable" });
  const result = operationalFollowUp(s, today).forecast;
  assert.equal(result.payables.priorPeriods, 200); assert.equal(result.payables.currentMonth, 1800);
  assert.equal(result.payables.rows.filter(row => row.period === "2026-09").length, 1);
});

test("forecast uses calendar month end including leap February, independent of inventory cutoff27", () => {
  const s = seed(); s.horses = [s.horses[0]]; s.expenses = [];
  Object.assign(s.horses[0], { entryDate: "2024-02-01", dueDate: "2024-02-29" });
  const leap = operationalFollowUp(s, "2024-02-27");
  assert.equal(leap.forecast.end, "2024-02-29"); assert.equal(leap.collectionTotals.upcoming, 1000);
  assert.equal(operationalFollowUp(s, "2024-02-29").collectionTotals.dueToday, 1000);
});

test("remaining daily and weekly expense commitments respect calendar length and partial payment", () => {
  const s = emptyState();
  s.expenses = [
    { id: "daily", name: "يومي", frequency: "daily", cost: 10, startMonth: "2024-02", expenseKind: "operating" },
    { id: "weekly", name: "أسبوعي", frequency: "weekly", cost: 70, startMonth: "2024-02", expenseKind: "operating" },
  ];
  s.expensePayments = [{ id: "part", expenseId: "daily", period: "2024-02", paidAt: "2024-02-10", amount: 50, status: "paid" }];
  const result = operationalFollowUp(s, "2024-02-15").forecast;
  assert.equal(result.payables.rows.find(row => row.expenseId === "daily")!.remaining, 240);
  assert.equal(result.payables.rows.find(row => row.expenseId === "weekly")!.remaining, 290);
  assert.equal(result.actual.paid, 50); assert.equal(result.payables.total, 530);
  assert.equal(result.projectedMovement, -580);
});

test("current-day actual cash uses Riyadh dates at the UTC month boundary", () => {
  const s = emptyState();
  s.income = [{ id: "saudi-nov", amount: 100, status: "collected", collectedAt: "2026-10-31T21:05:00Z" }];
  s.expensePayments = [{ id: "saudi-nov-pay", amount: 40, status: "paid", paidAt: "2026-10-31T21:10:00Z", period: "2026-11" }];
  assert.deepEqual(operationalFollowUp(s, "2026-11-01").forecast.actual, { collected: 100, paid: 40, net: 60 });
  assert.equal(operationalFollowUp(s, "2026-10-31").forecast.actual.collected, 0);
});

test("review observations identify missing feeding, price, units, allocation and due terms without correcting data", () => {
  const s = seed();
  s.mealTypes[0].pricePerUnit = 0; s.mealTypes[0].unit = "";
  s.horses[0].feeding[0].quantity = 0; delete s.horses[0].dueDate;
  s.expenses.push({ id: "orphan", name: "مصروف قديم", cost: 300, frequency: "once", incurredAt: today,
    expenseKind: "operating", allocationScope: "selected", horseIds: ["missing-horse"] });
  const before = structuredClone(s), result = operationalFollowUp(s, today);
  for (const code of ["feeding_missing", "feeding_quantity_missing", "feed_price_missing", "feed_unit_missing", "expense_unallocated", "expense_allocation_approval", "boarding_terms_missing"])
    assert.ok(result.observations.some(item => item.code === code), code);
  assert.equal(result.forecast.receivablesComplete, false);
  assert.deepEqual(s, before);
});

test("read-only follow-up leaves cash, receipt ledgers and closed financial summaries unchanged", () => {
  const s = operated(), before = structuredClone(s), cash = financialSummary(s, "2026-10");
  operationalFollowUp(s, today); operationalFollowUp(s, today);
  assert.deepEqual(s, before); assert.deepEqual(financialSummary(s, "2026-10"), cash);
});

test("missing or blank boarding fees are unknown rather than a confirmed free stay, while numeric zero is valid", () => {
  for (const value of [undefined, null, "", " ", Number.NaN, Number.POSITIVE_INFINITY, -1]) {
    const s = seed(); s.horses[0].boardingFee = value;
    const result = operationalFollowUp(s, today);
    assert.equal(result.forecast.receivablesComplete, false, String(value));
    assert.equal(result.forecast.complete, false);
    assert.ok(result.observations.some(item => item.code === "boarding_terms_missing" && item.id === "late"));
    assert.ok(Number.isFinite(result.forecast.projectedMovement));
  }
  for (const value of [0, "0"]) {
    const s = seed(); s.horses[0].boardingFee = value;
    const result = operationalFollowUp(s, today);
    assert.equal(result.forecast.receivablesComplete, true);
    assert.equal(result.observations.some(item => item.code === "boarding_terms_missing"), false);
  }
});

test("missing expense amount or once-only date cannot disappear from a forecast marked complete", () => {
  for (const value of [undefined, null, "", " ", Number.NaN, Number.POSITIVE_INFINITY, -1]) {
    const s = seed(); s.expenses[0].cost = value;
    const result = operationalFollowUp(s, today);
    assert.equal(result.forecast.payablesComplete, false, String(value));
    assert.equal(result.forecast.complete, false);
    assert.ok(result.observations.some(item => item.code === "expense_cost_missing"));
    assert.ok(Number.isFinite(result.forecast.projectedMovement));
  }
  const s = seed(); s.expenses = [{ id: "no-date", name: "طبيب", frequency: "once", cost: 200, expenseKind: "operating" }];
  assert.equal(operationalFollowUp(s, today).forecast.payablesComplete, false);
  s.expenses[0].incurredAt = today; s.expenses[0].cost = 0;
  const result = operationalFollowUp(s, today);
  assert.equal(result.forecast.payablesComplete, true); assert.equal(result.forecast.payables.total, 0);
  assert.equal(result.observations.some(item => item.code === "expense_cost_missing"), false);
});

test("incomplete receipt amounts or dates never silently settle an owner balance or become confirmed cash", () => {
  for (const change of [{ amount: null }, { amount: "" }, { amount: Number.NaN }, { collectedAt: "" }, { collectedAt: "2026-02-30" }]) {
    const s = seed();
    s.income.push({ id: "incomplete", horseId: "today", status: "collected", accountVersion: 1, amount: 800, collectedAt: now,
      allocations: [{ id: "boarding_2026-10-21", amount: 800 }], ...change });
    const before = structuredClone(s), result = operationalFollowUp(s, today);
    assert.equal(result.forecast.cashComplete, false); assert.equal(result.forecast.receivablesComplete, false);
    assert.equal(result.forecast.complete, false); assert.equal(result.forecast.actual.collected, 0);
    assert.equal(result.collectionTotals.dueToday, 800);
    assert.ok(result.observations.some(item => item.code === "receipt_cash_incomplete"));
    assert.deepEqual(s, before);
  }
});

test("incomplete supplier payments do not confirm settlement, and pending payments are not actual cash", () => {
  for (const change of [{ amount: null }, { amount: "" }, { amount: Number.NaN }, { paidAt: "" }, { paidAt: "2026-02-30" }]) {
    const s = seed();
    s.expensePayments.push({ id: "incomplete-pay", expenseId: "salary", period: "2026-10", status: "paid", amount: 1800, paidAt: today, ...change });
    const result = operationalFollowUp(s, today);
    assert.equal(result.forecast.cashComplete, false); assert.equal(result.forecast.payablesComplete, false);
    assert.equal(result.forecast.actual.paid, 0); assert.equal(result.forecast.payables.total, 1800);
    assert.ok(result.observations.some(item => item.code === "payment_cash_incomplete"));
  }
  const s = seed(); s.expensePayments.push({ id: "unconfirmed", expenseId: "salary", period: "2026-10", status: "pending", amount: 1800, paidAt: today });
  const result = operationalFollowUp(s, today);
  assert.equal(result.forecast.actual.paid, 0); assert.equal(result.forecast.payables.total, 1800);
  assert.equal(result.forecast.cashComplete, true);
});

test("valid cash with missing ledger links stays in actual cash but warns that balances are incomplete", () => {
  const s = seed();
  s.income.push({ id: "unlinked", amount: 100, collectedAt: now, status: "collected" });
  s.expensePayments.push({ id: "unallocated", amount: 40, paidAt: today, status: "paid", expenseId: "salary" });
  const result = operationalFollowUp(s, today);
  assert.deepEqual(result.forecast.actual, { collected: 100, paid: 40, net: 60 });
  assert.equal(result.forecast.cashComplete, true);
  assert.equal(result.forecast.receivablesComplete, false); assert.equal(result.forecast.payablesComplete, false);
  assert.equal(result.forecast.complete, false);
  assert.ok(result.observations.some(item => item.code === "receipt_link_missing"));
  assert.ok(result.observations.some(item => item.code === "payment_period_missing"));
});
