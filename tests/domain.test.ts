import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyCommand,
  emptyState,
  Actor,
  nextMonth,
  shares,
  bill,
} from "../functions/src/domain";
const admin: Actor = { uid: "admin", role: "admin", displayName: "Admin" },
  owner: Actor = { uid: "owner", role: "owner", displayName: "Owner" };
function seed() {
  const s = emptyState();
  s.users = [{ id: "owner", displayName: "Owner" }];
  s.mealTypes = [{ id: "feed", currentStock: 10 }];
  s.horses = ["h1", "h2"].map((id) => ({
    id,
    name: id,
    ownerId: "owner",
    ownerName: "Owner",
    status: "boarding",
    boardingFee: 2500,
    dueDate: "2026-01-31",
  }));
  return s;
}
let counter = 0;
const cmd = (action: string, id?: string, data?: any) => ({
  action,
  id,
  data,
  requestId: "testop_" + ++counter,
});
test("members cannot perform staff actions or approve other owners requests", () => {
  assert.throws(
    () =>
      applyCommand(
        seed(),
        owner,
        cmd("stock.move", "feed", { type: "add", amount: 4 }),
      ),
    /للإدارة/,
  );
  const s = seed();
  s.registrationRequests = [
    { id: "r", ownerId: "another", status: "awaiting_owner_approval" },
  ];
  assert.throws(
    () => applyCommand(s, owner, cmd("request.accept", "r")),
    /طلبك فقط/,
  );
});
test("disabled accounts cannot mutate", () =>
  assert.throws(
    () =>
      applyCommand(
        seed(),
        { ...admin, disabled: true },
        cmd("meal.delete", "feed"),
      ),
    /معطل/,
  ));
test("stock cannot become negative and rejects invalid amounts", () => {
  const s = seed();
  assert.throws(
    () =>
      applyCommand(
        s,
        admin,
        cmd("stock.move", "feed", { type: "remove", amount: 11 }),
      ),
    /تتجاوز/,
  );
  for (const amount of [-1, "", NaN, Infinity])
    assert.throws(() =>
      applyCommand(
        s,
        admin,
        cmd("stock.move", "feed", { type: "add", amount }),
      ),
    );
  assert.equal(s.mealTypes[0].currentStock, 10);
});
test("stock movement has an atomic balance, history and idempotency receipt", () => {
  const c = cmd("stock.move", "feed", { type: "remove", amount: 3 });
  const s = applyCommand(seed(), admin, c);
  assert.equal(s.mealTypes[0].currentStock, 7);
  assert.equal(s.inventoryTransactions.length, 1);
  assert.deepEqual(applyCommand(s, admin, c), s);
});
test("request approval creates exactly one horse with next due date", () => {
  let s = applyCommand(
    seed(),
    owner,
    cmd("request.create", undefined, {
      horseName: "أصيل",
      age: "4",
      requestType: "boarding_breeding",
    }),
    "2026-01-31T12:00:00Z",
  );
  const id = s.registrationRequests[0].id;
  s = applyCommand(
    s,
    admin,
    cmd("request.review", id, {
      status: "awaiting_owner_approval",
      boardingFee: 2000,
    }),
  );
  const c = cmd("request.accept", id);
  s = applyCommand(s, owner, c, "2026-01-31T12:00:00Z");
  assert.equal(s.horses.at(-1)?.status, "boarding_breeding");
  assert.equal(s.horses.at(-1)?.dueDate, "2026-02-28");
  assert.deepEqual(applyCommand(s, owner, c), s);
  assert.throws(
    () => applyCommand(s, owner, cmd("request.accept", id)),
    /بانتظار/,
  );
});
test("shared expense total remains fixed after sequential collections", () => {
  let s = applyCommand(
    seed(),
    admin,
    cmd("expense.save", undefined, {
      name: "Vet",
      cost: 400,
      frequency: "once",
      horseIds: ["h1", "h2"],
    }),
  );
  for (const id of ["h1", "h2"]) {
    const h = s.horses.find((h) => h.id === id)!;
    assert.equal(bill(s, h).amount, 2700);
    s = applyCommand(
      s,
      admin,
      cmd("income.collect", id, {
        expectedDueDate: "2026-01-31",
        expectedAmount: 2700,
      }),
      "2026-02-05T12:00:00Z",
    );
  }
  assert.equal(
    s.income.reduce((n, i) => n + i.amount, 0),
    5400,
  );
  assert.equal(bill(s, s.horses[0]).amount, 2500);
  assert.equal(s.horses[0].dueDate, "2026-02-28");
  assert.throws(
    () => applyCommand(s, admin, cmd("expense.delete", s.expenses[0].id)),
    /بتحصيل/,
  );
});
test("stale collection cannot charge a second period or wrong price", () => {
  let s = seed();
  const c = cmd("income.collect", "h1", {
    expectedDueDate: "2026-01-31",
    expectedAmount: 2500,
  });
  s = applyCommand(s, admin, c);
  assert.deepEqual(applyCommand(s, admin, c), s);
  assert.throws(
    () => applyCommand(s, admin, cmd("income.collect", "h1", c.data)),
    /تغير موعد/,
  );
  assert.throws(
    () =>
      applyCommand(
        seed(),
        admin,
        cmd("income.collect", "h1", {
          expectedDueDate: "2026-01-31",
          expectedAmount: 3000,
        }),
      ),
    /تغير المبلغ/,
  );
});
test("currency shares round without losing a cent", () => {
  const values = Object.values(shares(100, ["a", "b", "c"]));
  assert.equal(
    values.reduce((a, b) => Math.round((a + b) * 100) / 100, 0),
    100,
  );
  assert.deepEqual(values, [33.34, 33.33, 33.33]);
});
test("billing date clamps month ends including leap year", () => {
  assert.equal(nextMonth("2024-01-31"), "2024-02-29");
  assert.equal(nextMonth("2026-12-31"), "2027-01-31");
  assert.throws(() => nextMonth("2026-02-31"));
});
test("employee may save but cannot delete expenses or alter settings", () => {
  const employee = { ...admin, role: "employee" } as Actor;
  const s = seed();
  s.expenses = [{ id: "e", cost: 10 }];
  assert.throws(
    () => applyCommand(s, employee, cmd("expense.delete", "e")),
    /للمدير/,
  );
  assert.throws(
    () =>
      applyCommand(
        s,
        employee,
        cmd("settings.save", undefined, { stableName: "test" }),
      ),
    /للمدير/,
  );
});
test("meal deletion cannot orphan feeding programs or stock", () => {
  const s = seed();
  assert.throws(
    () => applyCommand(s, admin, cmd("meal.delete", "feed")),
    /تصفير/,
  );
  s.mealTypes[0].currentStock = 0;
  s.horses[0].feeding = [{ mealTypeId: "feed", quantity: 1 }];
  assert.throws(
    () => applyCommand(s, admin, cmd("meal.delete", "feed")),
    /مرتبط/,
  );
});
