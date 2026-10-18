import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyState, applyCommand } from "../functions/src/domain";
import { inventoryCycle, inventoryNeeds } from "../functions/src/inventory-needs";
import { consumeScheduledFeeding } from "../functions/src/feeding-stock";
import { financialSummary } from "../functions/src/finance";
const day = "2026-10-18";
function fixture(unit = "ربطة", quantity = .2, stock = 10) {
  const s = emptyState();
  s.mealTypes = [{id:"feed",name:"رودس",unit,currentStock:stock,pricePerUnit:30,minThreshold:2}];
  s.horses = Array.from({length:8}, (_,i) => ({id:`h${i}`,name:`خيل ${i}`,status:"private",entryDate:"2026-09-01",feeding:[{mealTypeId:"feed",quantity,frequency:"daily"}]}));
  return s;
}
test("cycle includes day 27, advances on 28, handles year boundaries and leap February", () => {
  assert.deepEqual(inventoryCycle(day),{today:day,start:"2026-09-28",end:"2026-10-27"});
  assert.equal(inventoryCycle("2026-10-27").end,"2026-10-27");
  assert.equal(inventoryCycle("2026-10-28").end,"2026-11-27");
  assert.equal(inventoryCycle("2026-12-28").end,"2027-01-27");
  assert.equal(inventoryCycle("2028-02-29").start,"2028-02-28");
  assert.throws(()=>inventoryCycle("2026-02-29"));
});
test("eight horses consume .2 bundle daily: 16 remaining, six to buy for 180, no rounding drift", () => {
  const item=inventoryNeeds(fixture(),day).items[0];
  assert.equal(item.remaining,16); assert.equal(item.cycleQuantity,48);
  assert.equal(item.shortage,6); assert.equal(item.cost,180);
  assert.equal(item.horses.length,8); assert.equal(item.horses[0].quantity,2);
});
test("purchase sacks convert to kg; stock and shortage have a common consumption unit", () => {
  const s=fixture("كيس 40 كجم",2,3);
  s.mealTypes[0].pricePerUnit=80;
  const item=inventoryNeeds(s,day).items[0];
  assert.equal(item.unit,"كجم");assert.equal(item.stock,120);assert.equal(item.remaining,160);
  assert.equal(item.shortage,40);assert.equal(item.purchaseQuantity,1);assert.equal(item.cost,80);
});
test("kg stock and per-horse quantities are aggregated without converting bale weights by guesswork",()=>{
  const s=fixture("كجم",2,190), item=inventoryNeeds(s,day).items[0];
  assert.equal(item.remaining,160);assert.equal(item.surplus,30);assert.equal(item.cost,0);
  s.mealTypes[0].unit="ربطة";assert.equal(inventoryNeeds(s,day).items[0].unit,"ربطة");
});
test("already posted today is not requested twice; depletion keeps purchasing need unchanged",()=>{
  const s=fixture();Object.assign(s.mealTypes[0],{autoFeedingFrom:day});
  const before=inventoryNeeds(s,day).items[0];
  const posted=consumeScheduledFeeding(s,day), after=inventoryNeeds(posted,day).items[0];
  assert.equal(after.remaining,14.4);assert.equal(after.stock,8.4);assert.equal(after.shortage,before.shortage);
  assert.deepEqual(inventoryNeeds(consumeScheduledFeeding(posted,day),day),inventoryNeeds(posted,day));
});
test("daily ledger presence protects today even if its through marker is missing",()=>{
  const s=fixture();s.inventoryTransactions=[{id:"ledger",movementKind:"feeding",mealTypeId:"feed",feedingDate:day}];
  assert.equal(inventoryNeeds(s,day).items[0].remaining,14.4);
});
test("a physical count including today starts remaining demand tomorrow",()=>{
  const s=applyCommand(fixture(),{uid:"admin",role:"admin",displayName:"admin"},{action:"stock.reconcile",id:"feed",requestId:"reconcile_test",data:{actualQuantity:10,reason:"جرد",activate:true}},day+"T12:00:00Z");
  const item=inventoryNeeds(s,day).items[0];assert.equal(item.remaining,14.4);assert.equal(item.shortage,4.4);
});
test("unposted past feed is reserved once and agrees with caught-up ledger",()=>{
  const s=fixture();Object.assign(s.mealTypes[0],{autoFeedingFrom:"2026-09-01",autoFeedingThrough:"2026-10-15"});
  const before=inventoryNeeds(s,day).items[0];assert.equal(before.pending,3.2);assert.equal(before.shortage,9.2);
  const after=inventoryNeeds(consumeScheduledFeeding(s,day),day).items[0];
  assert.equal(after.pending,0);assert.equal(after.shortage,before.shortage);assert.equal(after.cost,before.cost);
});
test("scheduled monthly dates remain calendar dates across the 28-to-27 cycle",()=>{
  const s=fixture();s.horses=s.horses.slice(0,1);
  s.horses[0].feeding=[{mealTypeId:"feed",quantity:.5,frequency:"monthly",timesPerMonth:2,schedule:[{weekday:6,ordinal:1},{weekday:6,ordinal:3}]}];
  const item=inventoryNeeds(s,"2026-10-28").items[0];
  assert.equal(item.remaining,1);assert.deepEqual(item.horses[0].dates,["2026-11-07","2026-11-21"]);
});
test("entry, exit, return, dose versions, skipped meals and private horses affect exact dates",()=>{
  const s=fixture();s.horses=s.horses.slice(0,1);
  Object.assign(s.horses[0],{status:"archived",stayPeriods:[{entryDate:"2026-10-19",exitDate:"2026-10-20"},{entryDate:"2026-10-25",exitDate:"2026-10-26"}],feedingHistory:[{from:"2026-10-01",feeding:[{mealTypeId:"feed",quantity:.2}]},{from:"2026-10-25",feeding:[{mealTypeId:"feed",quantity:.5}]}],feedingSkips:[{mealTypeId:"feed",date:"2026-10-26"}]});
  assert.equal(inventoryNeeds(s,day).items[0].remaining,.9);
});
test("legacy count-only plans are flagged incomplete, never silently labelled sufficient",()=>{
  const s=fixture();s.horses[0].feeding=[{mealTypeId:"feed",quantity:.5,frequency:"monthly",timesPerMonth:7}];
  const n=inventoryNeeds(s,day);assert.equal(n.incomplete,true);assert.deepEqual(n.items[0].unscheduled,["خيل 0"]);assert.equal(n.items[0].remaining,14);
});
test("negative balance carries shortage, unknown prices stay incomplete, no horses means no new feed",()=>{
  const s=fixture("ربطة",.2,-2);s.mealTypes[0].pricePerUnit=undefined;
  const n=inventoryNeeds(s,day);assert.equal(n.items[0].shortage,18);assert.equal(n.missingPrices,true);
  s.horses=[];assert.equal(inventoryNeeds(s,day).items[0].remaining,0);
});
test("planning is read-only and does not alter closed periods or cash; purchases count exactly once",()=>{
  const s=fixture();s.financialPeriods=[{id:"2026-09",closed:true,summary:{sentinel:42}}];
  const before=structuredClone(s);inventoryNeeds(s,day);assert.deepEqual(s,before);
  const cmd={action:"stock.purchase",id:"feed",requestId:"purchase_test",data:{amount:6,total:180,paidAt:day,method:"cash"}};
  const actor={uid:"admin",role:"admin" as const,displayName:"admin"};
  const bought=applyCommand(s,actor,cmd,day+"T12:00:00Z");
  assert.equal(inventoryNeeds(bought,day).items[0].shortage,0);
  inventoryNeeds(bought,day);assert.equal(bought.expensePayments.length,1);assert.equal(bought.expenses.length,1);
  assert.deepEqual(applyCommand(bought,actor,cmd,day+"T12:00:00Z"),bought);
  assert.deepEqual(bought.financialPeriods.filter(p=>p.closed),s.financialPeriods);
  assert.equal(financialSummary(bought,"2026-10").paid,180);
});
