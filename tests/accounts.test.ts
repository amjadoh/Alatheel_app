import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyCommand,
  emptyState,
  type State,
  type Actor,
} from "../functions/src/domain";
import {
  horseAccount,
  planPayment,
  accountRevision,
} from "../functions/src/accounts";
import { horseFinance } from "../functions/src/finance";
import { horseCost } from "../functions/src/estimates";
const now = "2026-10-16T10:00:00Z",
  today = "2026-10-16";
const admin: Actor = { uid: "admin", role: "admin", displayName: "مدير" };
let seq = 0;
function seed() {
  const s = emptyState();
  s.owners = [{ id: "o", displayName: "مالك" }];
  s.horses = [
    {
      id: "h",
      name: "خيل",
      ownerId: "o",
      status: "boarding",
      entryDate: "2026-06-01",
      dueDate: "2026-06-01",
      boardingFee: 700,
      feeding: [],
    },
  ];
  return s;
}
function pay(s: State, data: any = {}, id?: string) {
  return applyCommand(
    s,
    admin,
    {
      action: "income.pay",
      id: "h",
      requestId: id || "account_" + ++seq,
      data: {
        paymentType: "partial",
        paidAt: today,
        amount: 200,
        method: "bank",
        periods: [],
        expectedRevision: accountRevision(s, s.horses[0]),
        ...data,
      },
    },
    now,
  );
}
test("three and a half of four selected arrears leaves exactly half of the fourth and current month untouched", () => {
  let s = pay(seed(), {
    paymentType: "arrears",
    periods: ["2026-09", "2026-08", "2026-07", "2026-06"],
    amount: 2450,
  });
  let a = horseAccount(s, s.horses[0], today);
  assert.deepEqual(
    a.items.map((x) => x.remaining),
    [0, 0, 0, 350, 700],
  );
  assert.equal(a.outstanding, 1050);
  assert.equal(s.horses[0].dueDate, "2026-09-01");
  assert.deepEqual(
    s.income[0].allocations.map((x: any) => x.amount),
    [700, 700, 700, 350],
  );
  s = pay(s, { paymentType: "monthly", amount: 700 });
  a = horseAccount(s, s.horses[0], today);
  assert.equal(a.outstanding, 350);
  assert.equal(a.items.find((x) => x.dueDate === "2026-09-01")?.remaining, 350);
  assert.equal(a.items.find((x) => x.dueDate === "2026-10-01")?.remaining, 0);
  s = pay(s, { paymentType: "arrears", periods: ["2026-09"], amount: 350 });
  assert.equal(horseAccount(s, s.horses[0], today).outstanding, 0);
  assert.equal(s.horses[0].dueDate, "2026-11-01");
});
test("month comes from payment date, not current month, and monthly does not clear older debt", () => {
  const s = pay(seed(), {
    paymentType: "monthly",
    paidAt: "2026-09-15",
    amount: 700,
  });
  const r = s.income[0];
  assert.equal(r.allocations[0].dueDate, "2026-09-01");
  assert.equal(r.collectedAt.slice(0, 10), "2026-09-15");
  assert.equal(horseFinance(s, s.horses[0], "2026-10").cash, 0);
  assert.equal(horseFinance(s, s.horses[0], "2026-09").cash, 700);
  assert.equal(horseAccount(s, s.horses[0], today).outstanding, 2800);
});
test("partial installment reduces only selected oldest outstanding cycle", () => {
  const s = pay(seed());
  assert.equal(s.horses[0].dueDate, "2026-06-01");
  assert.equal(horseAccount(s, s.horses[0], today).items[0].remaining, 500);
});
test("advance balance covers future periods without new cash receipts", () => {
  const s = pay(seed(), { amount: 5000 });
  assert.equal(horseAccount(s, s.horses[0], today).credit, 1500);
  const nov = horseFinance(s, s.horses[0], "2026-11");
  assert.equal(nov.outstanding, 0);
  assert.equal(nov.advanceCredit, 800);
  assert.equal(nov.cash, 0);
  assert.equal(horseFinance(s, s.horses[0], "2027-01").outstanding, 600);
  assert.equal(s.income.length, 1);
});
test("historical cutoffs ignore later payments, including migrated accounts", () => {
  const s = pay(seed(), { amount: 3500 });
  assert.equal(horseFinance(s, s.horses[0], "2026-09").outstanding, 2800);
  assert.equal(horseFinance(s, s.horses[0], "2026-10").outstanding, 0);
});
test("legacy receipt records stay unchanged and paid history is visible without inventing entry-date arrears", () => {
  let s = seed();
  s.horses[0].dueDate = "2026-10-01";
  s.income = [
    {
      id: "legacy",
      horseId: "h",
      ownerId: "o",
      amount: 700,
      boardingFee: 700,
      dueDate: "2026-09-01",
      collectedAt: "2026-09-05T12:00:00Z",
      status: "collected",
    },
  ];
  const old = structuredClone(s.income[0]);
  s = pay(s, { amount: 200 });
  assert.deepEqual(s.income[0], old);
  const a = horseAccount(s, s.horses[0], today);
  assert.equal(a.items.length, 2);
  assert.equal(a.outstanding, 500);
  assert.equal(a.receipts.length, 2);
});
test("duplicate request is idempotent, concurrent stale payment fails, owners cannot collect", () => {
  const start = seed(),
    revision = accountRevision(start, start.horses[0]);
  const s = pay(start, {}, "same_request");
  assert.deepEqual(pay(s, { expectedRevision: revision }, "same_request"), s);
  assert.throws(() => pay(s, { expectedRevision: revision }), /تغير كشف/);
  assert.throws(
    () =>
      applyCommand(
        start,
        { uid: "o", role: "owner", displayName: "مالك" },
        { action: "income.pay", id: "h", requestId: "owner_payment", data: {} },
      ),
    /للإدارة/,
  );
});
test("arrears reject current months, excessive selected amount, empty selection and future dates", () => {
  assert.throws(
    () =>
      pay(seed(), {
        paymentType: "arrears",
        periods: ["2026-10"],
        amount: 100,
      }),
    /أشهرًا سابقة/,
  );
  assert.throws(
    () =>
      pay(seed(), {
        paymentType: "arrears",
        periods: ["2026-09"],
        amount: 701,
      }),
    /يتجاوز/,
  );
  assert.throws(
    () => pay(seed(), { paymentType: "arrears", periods: [], amount: 100 }),
    /اختر/,
  );
  assert.throws(() => pay(seed(), { paidAt: "2026-10-17" }), /مستقبلي/);
  assert.throws(
    () => pay(seed(), { paymentType: "monthly", amount: 100 }),
    /استحقاق الشهر/,
  );
});
test("cents are conserved across split installments and a prepaid cent", () => {
  let s = seed();
  s.horses[0].boardingFee = 10.01;
  s.horses[0].dueDate = "2026-10-01";
  s = pay(s, { amount: 5.55 });
  s = pay(s, { amount: 4.47 });
  const a = horseAccount(s, s.horses[0], today);
  assert.equal(a.outstanding, 0);
  assert.equal(a.credit, 0.01);
  assert.equal(a.paid, 10.02);
});
test("allocated owner expenses support partial payment and become immutable", () => {
  const s = seed();
  s.horses[0].dueDate = "2026-11-01";
  s.expenses = [
    {
      id: "e",
      name: "بيطري",
      cost: 100,
      frequency: "once",
      incurredAt: "2026-10-01",
      allocations: { h: 100 },
      collectedHorseIds: [],
    },
  ];
  const n = pay(s, { amount: 40 });
  assert.equal(horseAccount(n, n.horses[0], today).outstanding, 60);
  assert.equal(n.expenses[0].lockedForReceipts, true);
  assert.throws(
    () =>
      applyCommand(n, admin, {
        action: "expense.delete",
        id: "e",
        requestId: "delete_expense",
      }),
    /بتحصيل/,
  );
});
test("fee changes freeze already charged periods", () => {
  let s = pay(seed(), { amount: 100 });
  const h = s.horses[0];
  s = applyCommand(
    s,
    admin,
    {
      action: "horse.save",
      id: "h",
      requestId: "change_fee",
      data: { ...h, boardingFee: 900 },
    },
    now,
  );
  assert.equal(horseFinance(s, s.horses[0], "2026-10").outstanding, 3400);
  assert.equal(horseFinance(s, s.horses[0], "2026-11").outstanding, 4300);
});
test("changing a billed horse to private cannot silently erase its arrears", () => {
  const s = pay(seed(), { amount: 100 }),
    h = s.horses[0];
  assert.throws(
    () =>
      applyCommand(
        s,
        admin,
        {
          action: "horse.save",
          id: "h",
          requestId: "hide_arrears",
          data: { ...h, status: "private" },
        },
        now,
      ),
    /إخراج الخيل/,
  );
});
test("paid future cycle remains a credit after checkout before its due date", () => {
  const s = seed();
  s.horses[0].dueDate = "2026-10-27";
  const n = pay(s, { paymentType: "monthly", amount: 700 });
  const out = applyCommand(
    n,
    admin,
    {
      action: "horse.checkout",
      id: "h",
      requestId: "checkout_with_credit",
      data: { exitDate: "2026-10-20", exitReason: "customer_request" },
    },
    "2026-10-20T12:00:00Z",
  );
  const a = horseAccount(out, out.horses[0], "2026-10-20");
  assert.equal(a.outstanding, 0);
  assert.equal(a.credit, 700);
  assert.equal(a.paid, 700);
});
test("daily legacy and seven monthly portions use independent multipliers including February", () => {
  const s = seed();
  s.horses[0].entryDate = "2024-01-01"; // The horse must be present in both February periods.
  s.mealTypes = [
    { id: "f", name: "مركزات", unit: "كيس 40 كجم", pricePerUnit: 90 },
    { id: "x", name: "إضافي", unit: "كجم", pricePerUnit: 10 },
  ];
  s.horses[0].feeding = [
    { mealTypeId: "f", quantity: 3 },
    { mealTypeId: "x", quantity: 0.5, frequency: "monthly", timesPerMonth: 7 },
  ];
  assert.equal(horseCost(s, s.horses[0], "2026-10").food, 244.25);
  assert.equal(horseCost(s, s.horses[0], "2026-02").food, 224);
  assert.equal(horseCost(s, s.horses[0], "2024-02").food, 230.75);
});
test("server preserves and validates monthly feeding frequency and quantity precision", () => {
  const s = seed();
  s.mealTypes = [{ id: "x", name: "صنف" }];
  const h = s.horses[0],
    save = (f: any) =>
      applyCommand(
        s,
        admin,
        {
          action: "horse.save",
          id: "h",
          requestId: "feeding_update",
          data: {
            ...h,
            feeding: [
              {
                mealTypeId: "x",
                quantity: 0.125,
                frequency: "monthly",
                timesPerMonth: 7,
                ...f,
              },
            ],
          },
        },
        now,
      );
  assert.equal(save({}).horses[0].feeding[0].timesPerMonth, 7);
  assert.throws(() => save({ timesPerMonth: 1.5 }), /عددًا صحيحًا/);
  assert.throws(() => save({ timesPerMonth: 0 }), /قيمة/);
  assert.throws(() => save({ frequency: "bad" }), /تكرار التغذية/);
});
test("revision ignores object-key insertion order and detects real ledger changes", () => {
  const s = seed(),
    h = s.horses[0];
  assert.equal(
    accountRevision(s, h),
    accountRevision(s, Object.fromEntries(Object.entries(h).reverse()) as any),
  );
  const n = structuredClone(s);
  n.horses[0].boardingFee = 701;
  assert.notEqual(accountRevision(s, h), accountRevision(n, n.horses[0]));
});
