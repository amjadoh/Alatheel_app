import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCommand, emptyState, type State, type Actor } from "../functions/src/domain";
import { accountRevision, horseAccount, isReceipt } from "../functions/src/accounts";
import { financialSummary, horseFinance } from "../functions/src/finance";
import { operationalFollowUp } from "../functions/src/follow-up";
import { receiptCash } from "../functions/src/receipt-cash";
const admin: Actor = { uid: "admin", role: "admin", displayName: "مدير" };
let seq = 0;
function seed() {
  const s = emptyState();
  s.horses = [{ id: "horse", name: "خيل", ownerId: "owner", ownerName: "مالك", status: "boarding", entryDate: "2026-08-01", dueDate: "2026-08-01", boardingFee: 1000 }];
  s.expenses = [{ id: "vet", name: "طبيب", frequency: "once", cost: 200, incurredAt: "2026-10-03", allocations: { horse: 200 }, horseIds: ["horse"] }];
  return s;
}
function pay(s: State, amount: number, day = "2026-10-16", extra: any = {}) {
  return applyCommand(s, admin, { action: "income.pay", id: "horse", requestId: "receipt_" + ++seq,
    data: { amount, paidAt: day, paymentType: "partial", periods: [], method: "bank", expectedRevision: accountRevision(s, s.horses[0]), ...extra } }, day + "T12:00:00Z");
}
function change(s: State, action = "income.void", extra: any = {}, day = "2026-10-20", actor = admin, requestId = "change_" + ++seq, receiptId = s.income.find(isReceipt)!.id) {
  return applyCommand(s, actor, { action, id: receiptId, requestId,
    data: { reason: "تصحيح تسجيل", expectedRevision: accountRevision(s, s.horses[0]), amount: 800, paymentType: "partial", paidAt: "2026-10-16", periods: [], method: "cash", ...extra } }, day + "T12:00:00Z");
}
const account = (s: State, day = "2026-10-20") => horseAccount(s, s.horses[0], day);
test("void restores owner debt immediately, keeps original evidence and removes open-month cash everywhere", () => {
  const before = pay(seed(), 1000), original = structuredClone(before.income[0]);
  const s = change(before);
  assert.equal(account(s).outstanding, 3200);
  assert.equal(account(s).paid, 0);
  assert.equal(s.income[0].status, "void");
  for (const key of Object.keys(original).filter(k => k !== "status")) assert.deepEqual(s.income[0][key], original[key]);
  assert.equal(s.income[0].changedBy, "admin");
  assert.equal(financialSummary(s, "2026-10").collected, 0);
  assert.equal(horseFinance(s, s.horses[0], "2026-10").cash, 0);
  assert.equal(operationalFollowUp(s, "2026-10-20").forecast.actual.collected, 0);
});
test("correction keeps linked original, changes method/date/amount and totals count replacement once", () => {
  const before = pay(seed(), 1000), id = before.income[0].id;
  const s = change(before, "income.correct", { paidAt: "2026-10-18", notes: "حوالة صحيحة" });
  assert.equal(s.income.length, 2);
  assert.equal(s.income[0].status, "replaced");
  const r = s.income[1];
  assert.equal(r.correctsReceiptId, id);
  assert.equal(r.amount, 800); assert.equal(r.method, "cash");
  assert.equal(r.collectedAt.slice(0,10), "2026-10-18");
  assert.equal(account(s).outstanding, 2400);
  assert.equal(financialSummary(s, "2026-10").collected, 800);
  assert.equal(operationalFollowUp(s, "2026-10-20").forecast.actual.collected, 800);
  assert.equal(operationalFollowUp(s, "2026-10-20").forecast.receivables.total, 2400);
});
test("void three-and-a-half-month arrears restores every selected month and leaves later payments active", () => {
  let s = seed(); s.horses[0].entryDate = s.horses[0].dueDate = "2026-06-01"; s.expenses = [];
  s = pay(s, 3500, "2026-10-16", { paymentType: "arrears", periods: ["2026-06", "2026-07", "2026-08", "2026-09"] });
  s = pay(s, 1000, "2026-10-18", { paymentType: "monthly" });
  s = change(s);
  assert.deepEqual(account(s).items.map(i => i.remaining), [1000,1000,1000,1000,0]);
  assert.equal(account(s).outstanding, 4000);
  assert.equal(financialSummary(s, "2026-10").collected, 1000);
});
test("reducing advance and then voiding recomputes credit without leaving phantom paid months", () => {
  let s = pay(seed(), 5000);
  assert.equal(account(s).credit, 1800);
  s = change(s, "income.correct", { amount: 3500 });
  assert.equal(account(s).credit, 300);
  s = change(s, "income.void", {}, "2026-10-20", admin, "void_corrected", s.income[1].id);
  assert.equal(account(s).credit, 0); assert.equal(account(s).outstanding, 3200);
});
test("expenses paid flags reopen after void and original audit lock remains", () => {
  let s = pay(seed(), 3200);
  assert.deepEqual(s.expenses[0].collectedHorseIds, ["horse"]);
  s = change(s);
  assert.deepEqual(s.expenses[0].collectedHorseIds, []);
  assert.equal(s.expenses[0].lockedForReceipts, true);
  assert.equal(account(s).items.find(i => i.expenseId === "vet")?.remaining, 200);
});
test("closed-month void preserves the entire snapshot and posts exactly one linked reversal now", () => {
  let s = pay(seed(), 1000, "2026-09-16");
  s = applyCommand(s, admin, { action: "finance.rollover", requestId: "rollover_october" }, "2026-10-01T12:00:00Z");
  const frozen = structuredClone(s.financialPeriods.find(p => p.id === "2026-09"));
  s = change(s);
  assert.deepEqual(s.financialPeriods.find(p => p.id === "2026-09"), frozen);
  assert.equal(financialSummary(s, "2026-09").collected, 1000);
  assert.equal(financialSummary(s, "2026-10").collected, -1000);
  assert.equal(horseFinance(s, s.horses[0], "2026-10").cash, -1000);
  const f = operationalFollowUp(s, "2026-10-20");
  assert.equal(f.forecast.actual.collected, -1000); assert.equal(f.forecast.cashComplete, true);
  assert.equal(f.forecast.receivables.total, 3200);
  assert.equal(receiptCash(s).length, 1);
  assert.equal(account(s).outstanding, 3200);
});
test("correcting a closed receipt books only the difference now and preserves its historical payment date", () => {
  let s = pay(seed(), 1000, "2026-09-16");
  s = change(s, "income.correct", { paidAt: "2026-09-16" });
  assert.equal(s.financialPeriods.find(p => p.id === "2026-09")?.closed, true);
  assert.equal(financialSummary(s, "2026-09").collected, 1000);
  assert.equal(financialSummary(s, "2026-10").collected, -200);
  assert.equal(account(s).paid, 800);
  assert.equal(account(s).outstanding, 2400);
  assert.equal(s.income[1].paidAt, "2026-09-16");
});
test("method-only closed correction is zero settlement and later correction/void does not double reverse", () => {
  let s = pay(seed(), 1000, "2026-09-16");
  s = change(s, "income.correct", { amount: 1000, paidAt: "2026-09-16" });
  assert.equal(financialSummary(s, "2026-10").collected, 0);
  s = change(s, "income.correct", { amount: 600, paidAt: "2026-09-16" }, "2026-10-20", admin, "second_correction", s.income[1].id);
  assert.equal(financialSummary(s, "2026-10").collected, -400);
  s = change(s, "income.void", {}, "2026-10-20", admin, "third_voiding", s.income[2].id);
  assert.equal(financialSummary(s, "2026-10").collected, -1000);
  assert.equal(account(s).paid, 0);
});
test("moving a payment between open dates changes reporting month only once", () => {
  const s = change(pay(seed(), 1000), "income.correct", { amount: 1000, paidAt: "2026-08-20" });
  // August was never frozen; correcting its date is recorded there.
  assert.equal(financialSummary(s, "2026-08").collected, 1000);
  assert.equal(financialSummary(s, "2026-10").collected, 0);
});
test("legacy void preserves known paid cycles without inventing intervening unknown months", () => {
  const original = seed(); original.expenses = []; original.horses[0].dueDate = "2026-10-01";
  original.income = [{ id: "legacy_receipt", horseId: "horse", ownerId: "owner", amount: 1000, boardingFee: 1000, dueDate: "2026-08-01", collectedAt: "2026-08-10T12:00:00Z", status: "collected" }];
  const s = change(original);
  assert.deepEqual(account(s).items.map(i => i.dueDate), ["2026-08-01", "2026-10-01"]);
  assert.equal(account(s).outstanding, 2000);
  assert.equal(s.horses[0].accountAnchor, "2026-10-01");
});
test("retries are idempotent and stale or already replaced/void receipts cannot mutate twice", () => {
  const s = pay(seed(), 1000), rev = accountRevision(s, s.horses[0]);
  const next = change(s, "income.correct", {}, "2026-10-20", admin, "stable_request");
  assert.deepEqual(change(next, "income.correct", { expectedRevision: rev }, "2026-10-20", admin, "stable_request", s.income[0].id), next);
  assert.throws(() => change(next, "income.void", {}, "2026-10-20", admin, "another_request", s.income[0].id), /سبق تصحيح/);
  assert.throws(() => change(next, "income.correct", { expectedRevision: rev }), /تغير كشف/);
  const canceled = change(s);
  assert.throws(() => change(canceled, "income.void", {}, "2026-10-20", admin, "void_again", s.income[0].id), /ملغاة/);
});
test("only admins can correct/void and reason, real date, method and positive amount are mandatory", () => {
  const s = pay(seed(), 1000);
  for (const action of ["income.correct", "income.void"]) {
    for (const role of ["employee", "owner", "viewer"] as const)
      assert.throws(() => change(s, action, {}, "2026-10-20", { ...admin, role }));
    assert.throws(() => change(s, action, { reason: "  " }), /سبب/);
  }
  for (const data of [{ paidAt: "2026-10-30" }, { amount: -1 }, { amount: "" }, { paidAt: "2026-02-31" }, { method: "invalid" }, { paymentType: "fake" }])
    assert.throws(() => change(s, "income.correct", data));
  assert.equal(s.income[0].status, "collected");
});
test("balances conserve every cent across many later allocations, corrections and voids",()=>{
  let s=seed();
  for(let i=0;i<45;i++){
    const live=s.income.filter(isReceipt);
    if(i%4===1&&live.length)s=change(s,"income.correct",{amount:(i*317%500000+1)/100},"2026-10-20",admin,"random_correct_"+i,live[i%live.length].id);
    else if(i%4===2&&live.length)s=change(s,"income.void",{},"2026-10-20",admin,"random_void_"+i,live[i%live.length].id);
    else s=pay(s,(i*151%500000+1)/100);
    const a=account(s),paid=s.income.filter(isReceipt).reduce((n,r)=>n+Math.round(r.amount*100),0);
    assert.equal(Math.round((a.charged+a.credit-a.outstanding)*100),paid);
    assert.equal(Math.round(financialSummary(s,"2026-10").collected*100),paid);
    assert.equal(Math.round(operationalFollowUp(s,"2026-10-20").forecast.receivables.total*100),Math.round(a.outstanding*100));
  }
});
test("correction then void across two month closures preserves both reports and lifetime cash",()=>{
  let s=pay(seed(),1000,"2026-09-16");
  s=change(s,"income.correct",{amount:800,paidAt:"2026-09-16"});
  const september=structuredClone(financialSummary(s,"2026-09")),october=structuredClone(financialSummary(s,"2026-10"));
  s=change(s,"income.void",{},"2026-11-03",admin,"november_void",s.income[1].id);
  assert.deepEqual(financialSummary(s,"2026-09"),september);
  assert.deepEqual(financialSummary(s,"2026-10"),october);
  assert.equal(financialSummary(s,"2026-11").collected,-800);
  assert.equal(september.collected+october.collected+financialSummary(s,"2026-11").collected,0);
  assert.equal(account(s,"2026-11-03").paid,0);
});
