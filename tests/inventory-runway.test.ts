import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyState, applyCommand } from "../functions/src/domain";
import { inventoryRunway } from "../functions/src/inventory-runway";
import { inventoryNeeds } from "../functions/src/inventory-needs";
import { addFeedingDays, stockPrecision } from "../functions/src/feeding";
import { consumeScheduledFeeding } from "../functions/src/feeding-stock";
import { financialSummary } from "../functions/src/finance";

const today = "2026-10-21";
function fixture(stock = 1.4, quantity = .2, horseCount = 3) {
  const s = emptyState();
  s.mealTypes = [{ id: "hay", name: "رودس", unit: "ربطة", currentStock: stock, pricePerUnit: 30, minThreshold: 1 }];
  s.horses = Array.from({ length: horseCount }, (_, i) => ({ id: `horse${i}`, name: `خيل ${i}`, status: "private",
    entryDate: "2026-01-01", feeding: [{ mealTypeId: "hay", quantity, frequency: "daily" }] }));
  return s;
}
const first = (s = fixture(), day = today, horizonDays = 180) => inventoryRunway(s, day, { horizonDays }).items[0];

test("three horses at .2 bundle require stock on October 23, with same-day provision and no delivery assumptions", () => {
  const s = fixture(), item = first(s);
  assert.equal(item.stock, 1.4); assert.equal(item.pending, 0); assert.equal(item.available, 1.4);
  assert.equal(item.stockoutDate, "2026-10-23"); assert.equal(item.lastCoveredDate, "2026-10-22");
  assert.equal(item.needsProvidingDate, "2026-10-23"); assert.equal(item.status, "within_horizon");
  assert.equal(item.unit, "ربطة"); assert.equal(item.conversion, 1);
  assert.equal("orderBy" in item, false); assert.equal("deliveryLeadDays" in item, false);
  const through27 = first(s, today, 7), monthly = inventoryNeeds(s, today).items[0];
  assert.equal(through27.required, 4.2); assert.equal(through27.required, monthly.remaining);
  assert.equal(monthly.shortage, 2.8); assert.equal(monthly.cost, 84);
});

test("fractional stock is sufficient for the last exact meal without floating-point premature shortage", () => {
  const item = first(fixture(.3, .1, 1));
  assert.equal(item.stockoutDate, "2026-10-24"); assert.equal(item.lastCoveredDate, "2026-10-23");
});

test("purchase units convert to consumption kg using the same explicit or legacy measure as inventory needs", () => {
  const s = fixture(2, 2, 3); s.mealTypes[0].unit = "كيس 40 كجم";
  const item = first(s), needs = inventoryNeeds(s, today).items[0];
  assert.equal(item.unit, "كجم"); assert.equal(item.purchaseUnit, "كيس 40 كجم");
  assert.equal(item.stock, 80); assert.equal(item.stock, needs.stock); assert.equal(item.conversion, 40);
  assert.equal(item.stockoutDate, addFeedingDays(today, 13));
  Object.assign(s.mealTypes[0], { unit: "ربطة", feedingUnit: "كجم", feedingUnitsPerPurchaseUnit: 20, currentStock: 1 });
  s.horses = s.horses.slice(0, 1); s.horses[0].feeding[0].quantity = 4;
  assert.equal(first(s).stockoutDate, addFeedingDays(today, 5));
});

test("twice-monthly feeding follows the first and third Saturdays instead of a daily average", () => {
  const s = fixture(.5, .5, 1);
  s.horses[0].feeding = [{ mealTypeId: "hay", quantity: .5, frequency: "monthly", timesPerMonth: 2,
    schedule: [{ weekday: 6, ordinal: 1 }, { weekday: 6, ordinal: 3 }] }];
  const item = first(s, today, 62);
  assert.equal(item.firstDemandDate, "2026-11-07");
  assert.equal(item.stockoutDate, "2026-11-21"); assert.equal(item.lastCoveredDate, "2026-11-20");
  assert.equal(item.required, 2);
});

test("posted feeding today is already in stock and is not forecast a second time", () => {
  const s = fixture(); s.mealTypes[0].autoFeedingFrom = today;
  const before = first(s), posted = consumeScheduledFeeding(s, today, today + "T12:00:00Z"), after = first(posted);
  assert.equal(after.stock, .8); assert.equal(after.firstDemandDate, "2026-10-22");
  assert.equal(after.stockoutDate, before.stockoutDate); assert.equal(stockPrecision(before.required - after.required), .6);
  delete posted.mealTypes[0].autoFeedingThrough;
  assert.equal(first(posted).stockoutDate, before.stockoutDate);
  assert.deepEqual(first(consumeScheduledFeeding(posted, today)), first(posted));
});

test("pending past feeding reserves stock once and agrees with the caught-up ledger", () => {
  const s = fixture(); Object.assign(s.mealTypes[0], { autoFeedingFrom: "2026-10-19", autoFeedingThrough: "2026-10-19" });
  const before = first(s);
  assert.equal(before.pending, .6); assert.equal(before.available, .8); assert.equal(before.stockoutDate, "2026-10-22");
  const posted = consumeScheduledFeeding(s, "2026-10-20", today + "T12:00:00Z"), after = first(posted);
  assert.equal(after.pending, 0); assert.equal(after.available, before.available); assert.equal(after.stockoutDate, before.stockoutDate);
  assert.equal(after.available, inventoryNeeds(posted, today).items[0].available);
});

test("a physical count including today begins remaining consumption tomorrow", () => {
  const s = fixture();
  const counted = applyCommand(s, { uid: "admin", role: "admin", displayName: "admin" }, {
    action: "stock.reconcile", id: "hay", requestId: "count_runway", data: { actualQuantity: 1.4, reason: "جرد", activate: true },
  }, today + "T12:00:00Z");
  const item = first(counted);
  assert.equal(item.firstDemandDate, "2026-10-22"); assert.equal(item.stockoutDate, "2026-10-24");
});

test("recorded stays, return, plan history and skipped dates determine consumption", () => {
  const s = fixture(.7, .2, 1);
  Object.assign(s.horses[0], { status: "archived", stayPeriods: [
    { entryDate: "2026-10-22", exitDate: "2026-10-23" }, { entryDate: "2026-10-26", exitDate: "2026-10-27" },
  ], feedingHistory: [
    { from: "2026-10-26", feeding: [{ mealTypeId: "hay", quantity: .5 }] },
    { from: "2026-10-01", feeding: [{ mealTypeId: "hay", quantity: .2 }] },
  ], feedingSkips: [{ mealTypeId: "hay", date: "2026-10-27" }] });
  const item = first(s);
  assert.equal(item.required, .9); assert.equal(item.stockoutDate, "2026-10-26");
  assert.equal(item.lastCoveredDate, "2026-10-25");
});

test("count-only or malformed monthly plans mark the item incomplete and withhold definitive dates", () => {
  const s = fixture();
  s.horses[0].feeding = [{ mealTypeId: "hay", quantity: .2, frequency: "monthly", timesPerMonth: 2 }];
  let item = first(s);
  assert.equal(item.needsScheduleData, true); assert.equal(item.incomplete, true);
  assert.deepEqual(item.unscheduled, ["خيل 0"]);
  assert.equal(item.stockoutDate, undefined); assert.equal(item.needsProvidingDate, undefined);
  assert.equal(item.lastCoveredDate, undefined); assert.equal(item.status, "incomplete");
  for (const schedule of [
    [{ weekday: 6, ordinal: 5 }, { weekday: 6, ordinal: 1 }],
    [{ weekday: 6, ordinal: 1 }, { weekday: 6, ordinal: 1 }],
    [{ weekday: 6, ordinal: 1 }],
  ]) {
    s.horses[0].feeding[0].schedule = schedule;
    item = first(s); assert.equal(item.needsScheduleData, true); assert.equal(item.stockoutDate, undefined);
  }
});

test("unknown historical automatic feeding cannot silently inflate available-stock certainty", () => {
  const s = fixture(5, .2, 1);
  Object.assign(s.mealTypes[0], { autoFeedingFrom: "2026-10-20" });
  s.horses[0].feedingHistory = [
    { from: "2026-10-01", feeding: [{ mealTypeId: "hay", quantity: .2, frequency: "monthly", timesPerMonth: 2 }] },
    { from: today, feeding: [{ mealTypeId: "hay", quantity: .2, frequency: "daily" }] },
  ];
  assert.equal(first(s).needsScheduleData, true); assert.equal(first(s).stockoutDate, undefined);
});

test("horizon is finite and never promises that a large stock lasts forever", () => {
  const item = first(fixture(180, 1, 1));
  assert.equal(item.required, 180); assert.equal(item.endingBalance, 0);
  assert.equal(item.stockoutDate, undefined); assert.equal(item.status, "beyond_horizon");
  assert.equal(item.lastCoveredDate, addFeedingDays(today, 179));
  assert.throws(() => inventoryRunway(fixture(), today, { horizonDays: 181 }));
  assert.throws(() => inventoryRunway(fixture(), today, { horizonDays: 0 }));
  assert.throws(() => inventoryRunway(fixture(), "2026-02-29"));
  assert.equal(inventoryRunway(fixture(), "2028-02-29", { horizonDays: 2 }).horizonEnd, "2028-03-01");
});

test("no active consumption differs from a stock shortage and negative stock is explicit", () => {
  const s = fixture(0); s.horses.forEach(horse => { horse.status = "archived"; horse.exitDate = "2026-10-20"; });
  assert.equal(first(s).status, "no_consumption"); assert.equal(first(s).stockoutDate, undefined);
  s.mealTypes[0].currentStock = -1;
  assert.equal(first(s).status, "shortage"); assert.equal(first(s).stockoutDate, today);
});

test("empty stock before a sparse feeding schedule needs provision on its first required day", () => {
  const s = fixture(0, .5, 1);
  s.horses[0].feeding = [{ mealTypeId: "hay", quantity: .5, frequency: "monthly", timesPerMonth: 1, schedule: [{ weekday: 6, ordinal: 1 }] }];
  const item = first(s);
  assert.equal(item.emptyNow, true); assert.equal(item.needsProvidingDate, "2026-11-07");
});

test("invalid stock or a backlog older than the bounded history never yields a confident date", () => {
  const s = fixture(); s.mealTypes[0].currentStock = Number.NaN;
  assert.equal(first(s).needsStockData, true); assert.equal(first(s).stockoutDate, undefined);
  s.mealTypes[0].currentStock = 1000; s.mealTypes[0].autoFeedingFrom = "2020-01-01";
  const item = first(s);
  assert.equal(item.pendingIncomplete, true); assert.equal(item.incomplete, true); assert.equal(item.stockoutDate, undefined);
  assert.equal(item.pending, 175.8); // Only days after the horses' January entry count.
});

test("missing or invalid recorded feeding quantities withhold dates instead of silently reducing demand", () => {
  for (const quantity of [undefined, null, "not-a-number", -1, 0, Number.POSITIVE_INFINITY]) {
    const s = fixture(); s.horses[0].feeding[0].quantity = quantity;
    const item = first(s);
    assert.equal(item.needsQuantityData, true); assert.equal(item.incomplete, true);
    assert.equal(item.stockoutDate, undefined); assert.equal(item.needsProvidingDate, undefined);
    assert.deepEqual(item.unknownQuantities, ["خيل 0"]);
  }
});

test("incomplete explicit conversion never falls back to an assumed bundle-to-kg ratio", () => {
  for (const factor of [undefined, null, "", 0, -1, "invalid", Number.POSITIVE_INFINITY]) {
    const s = fixture(); Object.assign(s.mealTypes[0], { feedingUnit: "كجم", feedingUnitsPerPurchaseUnit: factor });
    assert.equal(first(s).needsUnitData, true); assert.equal(first(s).stockoutDate, undefined);
  }
  const s = fixture(); s.mealTypes[0].feedingUnitsPerPurchaseUnit = 20;
  assert.equal(first(s).needsUnitData, true);
  s.mealTypes[0].feedingUnit = "كجم";
  assert.equal(first(s).needsUnitData, false);
});

test("forecast reads each horse's plan history once, rather than for every item and day", () => {
  const s = fixture(100, .2, 20); let reads = 0;
  for (const horse of s.horses) Object.defineProperty(horse, "feedingHistory", { get() {
    reads++; return [{ from: "2026-01-01", feeding: horse.feeding }];
  } });
  inventoryRunway(s, today);
  assert.equal(reads, s.horses.length);
});

test("forecast is read-only and buying once changes stock without adding a second expense or altering closed months", () => {
  const s = fixture(); s.financialPeriods = [{ id: "2026-09", closed: true, summary: { sentinel: 42 } }];
  const before = structuredClone(s); inventoryRunway(s, today); assert.deepEqual(s, before);
  const actor = { uid: "admin", role: "admin" as const, displayName: "admin" };
  const command = { action: "stock.purchase", id: "hay", requestId: "purchase_runway", data: { amount: 2.8, total: 84, paidAt: today, method: "cash" } };
  const bought = applyCommand(s, actor, command, today + "T12:00:00Z");
  const cash = financialSummary(bought, "2026-10").paid, original = structuredClone(bought);
  assert.equal(first(bought).stockoutDate, "2026-10-28");
  assert.equal(cash, 84); assert.equal(bought.expenses.length, 1); assert.equal(bought.expensePayments.length, 1);
  assert.deepEqual(bought, original); assert.deepEqual(bought.financialPeriods.filter(period => period.closed), s.financialPeriods);
  assert.deepEqual(applyCommand(bought, actor, command, today + "T12:00:00Z"), bought);
});
