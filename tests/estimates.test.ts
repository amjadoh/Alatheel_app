import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyState, applyCommand, bill, money } from "../functions/src/domain";
import { feedingMeasure, feedingUnitPrice } from "../functions/src/feeding";
import {
  costs,
  horseCost,
  monthlyExpense,
  expenseShares,
} from "../functions/src/estimates";

test("real stable purchase records are not counted twice and missing Rhodes consumption is disclosed", () => {
  const s = stable();
  s.mealTypes.push({
    id: "rhodes",
    name: "رودس",
    unit: "ربطة",
    pricePerUnit: 20,
  });
  s.expenses = [
    {
      id: "purchase",
      name: "مركزات",
      cost: 1530,
      frequency: "monthly",
      horseIds: s.horses.map((h) => h.id),
    },
    {
      id: "rhodes_purchase",
      name: "رودس",
      cost: 900,
      frequency: "monthly",
      horseIds: s.horses.map((h) => h.id),
    },
    {
      id: "salary",
      name: "راتب العامل",
      cost: 1800,
      frequency: "monthly",
      horseIds: s.horses.map((h) => h.id),
    },
  ];
  assert.equal(costs(s, "2026-10").total, 3020.63);
  assert.equal(costs(s, "2026-10").purchases, 2430);
  assert.equal(horseCost(s, s.horses[0], "2026-10").total, 509.25);
  assert.equal(horseCost(s, s.horses[1], "2026-10").total, 474.38);
  assert.deepEqual(horseCost(s, s.horses[0], "2026-10").missingFeed, ["رودس"]);
  s.horses[0].feeding.push({ mealTypeId: "rhodes", quantity: 0.25 });
  assert.equal(horseCost(s, s.horses[0], "2026-10").food, 364.25);
  assert.deepEqual(horseCost(s, s.horses[0], "2026-10").missingFeed, []);
  // Explicit classification overrides automatic matching of old expense names.
  s.expenses[0].expenseKind = "operating";
  assert.equal(horseCost(s, s.horses[0], "2026-10").other, 555);
});

test("selected once-only expense estimates preserve saved ledger allocations", () => {
  const s = stable();
  s.expenses = [
    {
      id: "vet",
      name: "خدمة",
      cost: 100,
      frequency: "once",
      createdAt: "2026-10-15",
      horseIds: ["horse0", "horse1", "horse2"],
      allocations: { horse0: 33.34, horse1: 33.33, horse2: 33.33 },
      collectedHorseIds: ["horse0"],
    },
  ];
  assert.equal(horseCost(s, s.horses[0], "2026-10").other, 33.34);
  assert.equal(horseCost(s, s.horses[0], "2026-11").other, 0);
  assert.equal(bill(s, s.horses[1]).amount, 1033.33);
});

test("saving a feed purchase links its stock item without creating owner collection allocations", () => {
  const s = stable(),
    admin = { uid: "admin", role: "admin" as const, displayName: "مدير" };
  const next = applyCommand(
    s,
    admin,
    {
      action: "stock.purchase",
      id: "feed",
      requestId: "buy_feed_001",
      data: {
        name: "شراء مركزات",
        expenseKind: "feed_purchase",
        mealTypeId: "feed",
        cost: 90,
        amount: 1,
        total: 90,
        paidAt: '2026-10-15',
        method: 'cash',
        frequency: "once",
        allocationScope: "selected",
        horseIds: ["horse0"],
      },
    },
    "2026-10-15T00:00:00Z",
  );
  assert.equal(next.expenses[0].mealTypeId, "feed");
  assert.deepEqual(next.expenses[0].allocations, {});
  assert.equal(costs(next, "2026-10").purchases, 90);
  assert.equal(costs(next, "2026-10").other, 0);
  assert.equal(bill(next, next.horses[0]).amount, 1000);
});

function stable() {
  const s = emptyState();
  s.mealTypes = [
    {
      id: "feed",
      name: "مركزات",
      unit: "كيس 40 كجم",
      pricePerUnit: 90,
      currentStock: 10,
    },
  ];
  s.horses = Array.from({ length: 6 }, (_, i) => ({
    id: `horse${i}`,
    name: `خيل ${i}`,
    status: "boarding",
    boardingFee: 1000,
    dueDate: "2026-11-01",
    feeding: [{ mealTypeId: "feed", quantity: i === 1 ? 2.5 : 3 }],
  }));
  return s;
}

test("40 kg bag at 90 SAR feeds a 3 kg horse at 209.25 SAR for October, not 8370", () => {
  const s = stable();
  assert.equal(feedingUnitPrice(s.mealTypes[0]), 2.25);
  assert.equal(horseCost(s, s.horses[0], "2026-10").food, 209.25);
  assert.equal(horseCost(s, s.horses[1], "2026-10").food, 174.38);
  assert.equal(costs(s, "2026-10").feeding, 1220.63);
  assert.equal(s.mealTypes[0].currentStock, 10);
  assert.equal(s.mealTypes[0].pricePerUnit, 90);
});

test("purchase conversions support saved units, Arabic weights, and direct units without guessing bale weights", () => {
  assert.deepEqual(feedingMeasure({ unit: "كيس ٤٠ كجم" }), {
    unit: "كجم",
    unitsPerPurchaseUnit: 40,
  });
  assert.deepEqual(feedingMeasure({ unit: "bag 40 kg" }), {
    unit: "كجم",
    unitsPerPurchaseUnit: 40,
  });
  assert.deepEqual(feedingMeasure({ unit: "كجم" }), {
    unit: "كجم",
    unitsPerPurchaseUnit: 1,
  });
  assert.deepEqual(feedingMeasure({ unit: "ربطة" }), {
    unit: "ربطة",
    unitsPerPurchaseUnit: 1,
  });
  assert.equal(
    feedingUnitPrice({
      unit: "ربطة",
      pricePerUnit: 20,
      feedingUnit: "كجم",
      feedingUnitsPerPurchaseUnit: 10,
    }),
    2,
  );
});

test("1800 monthly salary is 300 per active horse; recurrent costs respect all four frequencies", () => {
  const s = stable();
  s.expenses = [
    {
      id: "salary",
      name: "راتب العامل",
      cost: 1800,
      frequency: "monthly",
      horseIds: [],
      createdAt: "2026-10-15",
    },
  ];
  assert.equal(horseCost(s, s.horses[0], "2026-10").other, 300);
  assert.equal(horseCost(s, s.horses[0], "2026-10").total, 509.25);
  assert.equal(costs(s, "2026-10").total, 3020.63);
  for (const [month, days] of [
    ["2026-10", 31],
    ["2026-11", 30],
    ["2024-02", 29],
  ] as const) {
    assert.equal(
      monthlyExpense({ ...s.expenses[0], frequency: "daily", cost: 10 }, month),
      days * 10,
    );
    assert.equal(
      monthlyExpense(
        { ...s.expenses[0], frequency: "weekly", cost: 70 },
        month,
      ),
      days * 10,
    );
    assert.equal(monthlyExpense(s.expenses[0], month), 1800);
  }
  assert.equal(
    monthlyExpense({ ...s.expenses[0], frequency: "once" }, "2026-10"),
    1800,
  );
  assert.equal(
    monthlyExpense({ ...s.expenses[0], frequency: "once" }, "2026-11"),
    0,
  );
  assert.equal(bill(s, s.horses[0]).amount, 1000);
});

test("shared costs exclude archived horses, include newly active horses, and preserve every cent", () => {
  const s = stable();
  const expense = {
    id: "shared",
    cost: 100,
    frequency: "monthly",
    allocationScope: "all_active",
    horseIds: [],
  };
  s.expenses = [expense];
  const allocated = () => Object.values(expenseShares(s, expense, "2026-10"));
  assert.equal(money(allocated().reduce((sum, n) => sum + n, 0)), 100);
  assert.equal(
    money(
      s.horses.reduce((sum, h) => sum + horseCost(s, h, "2026-10").total, 0),
    ),
    costs(s, "2026-10").total,
  );
  s.horses[0].status = "archived";
  assert.equal(horseCost(s, s.horses[0], "2026-10").other, 0);
  assert.equal(allocated().length, 5);
  assert.equal(allocated()[0], 20);
  s.horses.push({ id: "new", name: "جديد", status: "private", feeding: [] });
  assert.equal(allocated().length, 6);
  assert.equal(money(allocated().reduce((sum, n) => sum + n, 0)), 100);
});

test("selected expenses only reach selected horses and zero horses never divides by zero", () => {
  const s = stable(),
    e = {
      id: "vet",
      cost: 100,
      frequency: "weekly",
      allocationScope: "selected",
      horseIds: ["horse0", "horse1"],
    };
  s.expenses = [e];
  assert.equal(horseCost(s, s.horses[2], "2026-10").other, 0);
  assert.equal(
    money(
      Object.values(expenseShares(s, e, "2026-10")).reduce(
        (sum, v) => sum + v,
        0,
      ),
    ),
    442.86,
  );
  assert.deepEqual(
    expenseShares(
      emptyState(),
      { ...e, allocationScope: "all_active" },
      "2026-10",
    ),
    {},
  );
  assert.equal(costs(emptyState(), "2026-10").total, 0);
});

test("server persists purchase conversions and shared expense scope without adding operational costs to owners bills", () => {
  const admin = { uid: "admin", role: "admin" as const, displayName: "مدير" };
  let s = stable();
  s = applyCommand(s, admin, {
    action: "meal.save",
    id: "feed",
    requestId: "save_feed_001",
    data: {
      ...s.mealTypes[0],
      minThreshold: 1,
      feedingUnit: "كجم",
      feedingUnitsPerPurchaseUnit: 40,
    },
  });
  assert.equal(s.mealTypes[0].feedingUnitsPerPurchaseUnit, 40);
  assert.throws(
    () =>
      applyCommand(s, admin, {
        action: "meal.save",
        id: "feed",
        requestId: "save_feed_bad",
        data: { ...s.mealTypes[0], feedingUnitsPerPurchaseUnit: 0 },
      }),
    /غير صحيحة/,
  );
  s = applyCommand(
    s,
    admin,
    {
      action: "expense.save",
      requestId: "shared_once_001",
      data: {
        name: "تشغيل عام",
        cost: 600,
        frequency: "once",
        allocationScope: "all_active",
        horseIds: ["horse0"],
      },
    },
    "2026-10-15T00:00:00Z",
  );
  assert.deepEqual(s.expenses[0].horseIds, []);
  assert.equal(horseCost(s, s.horses[0], "2026-10").other, 100);
  assert.equal(bill(s, s.horses[0]).amount, 1000);
  assert.throws(
    () =>
      applyCommand(s, admin, {
        action: "expense.save",
        requestId: "selected_bad_001",
        data: {
          name: "test",
          cost: 5,
          frequency: "monthly",
          allocationScope: "selected",
          horseIds: [],
        },
      }),
    /اختر الخيل/,
  );
});
