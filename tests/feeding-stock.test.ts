import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyState, applyCommand, type State } from "../functions/src/domain";
import { consumeScheduledFeeding } from "../functions/src/feeding-stock";
import { horseCost } from "../functions/src/estimates";
import { scheduledFeedingDates, validateFeedingSchedule } from "../functions/src/feeding";
const actor={uid:"admin",role:"admin" as const,displayName:"مدير"};
function fixture(){const s=emptyState();s.mealTypes=[{id:"feed",name:"رودس",unit:"كجم",pricePerUnit:5,currentStock:100,minThreshold:20}];s.horses=[{id:"horse",name:"خيل",status:"private",entryDate:"2026-10-01",feeding:[{mealTypeId:"feed",quantity:2,frequency:"daily"}]}];return s;}
const run=(s:State,action:string,data:any,id="feed",now="2026-10-18T12:00:00Z",requestId="request_123")=>applyCommand(s,actor,{action,id,data,requestId},now);
test("actual count starts automation tomorrow and daily depletion is idempotent with no new cash",()=>{
 let s=run(fixture(),"stock.reconcile",{actualQuantity:100,reason:"تأكيد الجرد",activate:true});
 assert.equal(s.mealTypes[0].autoFeedingFrom,"2026-10-19");
 s=consumeScheduledFeeding(s,"2026-10-18");assert.equal(s.mealTypes[0].currentStock,100);
 s=consumeScheduledFeeding(s,"2026-10-21");assert.equal(s.mealTypes[0].currentStock,94);
 assert.equal(s.inventoryTransactions.filter(x=>x.movementKind==="feeding").length,3);
 assert.deepEqual(consumeScheduledFeeding(s,"2026-10-21"),s);
 assert.equal(s.expenses.length+s.expensePayments.length+s.income.length,0);
});
test("ordinal monthly feeding has exact calendar dates and quantity/cost rather than prorated monthly counts",()=>{
 const s=fixture();s.horses[0].feeding=[{mealTypeId:"feed",quantity:.5,frequency:"monthly",timesPerMonth:2,schedule:[{weekday:6,ordinal:1},{weekday:6,ordinal:3}]}];
 assert.deepEqual(scheduledFeedingDates(s.horses[0].feeding[0],"2026-11"),["2026-11-07","2026-11-21"]);
 assert.equal(horseCost(s,s.horses[0],"2026-11").food,5);
 s.horses[0].entryDate="2026-11-10";assert.equal(horseCost(s,s.horses[0],"2026-11").food,2.5);
 assert.throws(()=>validateFeedingSchedule([{weekday:6,ordinal:1},{weekday:6,ordinal:1}],2));
});
test("stock and estimates honor dose versions, stays, and private horse feeding",()=>{
 let s=fixture();s.mealTypes[0].autoFeedingFrom="2026-10-01";s.mealTypes[0].autoFeedingThrough="2026-10-17";
 s.horses[0].feeding=[{mealTypeId:"feed",quantity:3}];s.horses[0].feedingHistory=[{from:"0000-00-00",feeding:[{mealTypeId:"feed",quantity:2}]},{from:"2026-10-20",feeding:[{mealTypeId:"feed",quantity:3}]}];
 s=consumeScheduledFeeding(s,"2026-10-21");assert.equal(s.mealTypes[0].currentStock,90);
 assert.equal(horseCost(s,s.horses[0],"2026-10").food,(19*2+12*3)*5);
 s.horses[0].status="archived";s.horses[0].exitDate="2026-10-20";
 assert.equal(horseCost(s,s.horses[0],"2026-10").food,(19*2+3)*5);
});
test("skip reverses only once, but a newer actual count prevents crediting the same shortage twice",()=>{
 let s=run(fixture(),"stock.reconcile",{actualQuantity:100,reason:"جرد",activate:true});
 s=consumeScheduledFeeding(s,"2026-10-19","2026-10-20T00:00:00Z");
 const skipped=run(s,"feeding.skip",{mealTypeId:"feed",date:"2026-10-19",reason:"لم تعط الوجبة"},"horse","2026-10-20T12:00:00Z","skip_111");
 assert.equal(skipped.mealTypes[0].currentStock,100);
 assert.equal(run(skipped,"feeding.skip",{mealTypeId:"feed",date:"2026-10-19",reason:"لم تعط الوجبة"},"horse","2026-10-20T12:00:00Z","skip_111").mealTypes[0].currentStock,100);
 s=run(s,"stock.reconcile",{actualQuantity:100,reason:"جرد فعلي"},"feed","2026-10-20T09:00:00Z","count_222");
 s=run(s,"feeding.skip",{mealTypeId:"feed",date:"2026-10-19",reason:"لم تعط الوجبة"},"horse","2026-10-20T12:00:00Z","skip_333");
 assert.equal(s.mealTypes[0].currentStock,100);
});
test("purchase-unit conversion retains fractional stock and shortages without clipping consumption",()=>{
 let s=fixture();Object.assign(s.mealTypes[0],{unit:"كيس 40 كجم",pricePerUnit:80,currentStock:.02,autoFeedingFrom:"2026-10-19"});
 s=consumeScheduledFeeding(s,"2026-10-19");assert.equal(s.mealTypes[0].currentStock,-.03);
 assert.equal(s.inventoryTransactions[0].amount,.05);
});
test("legacy count-only plans remain estimates and never cause fabricated scheduled stock depletion",()=>{
 let s=fixture();s.horses[0].feeding=[{mealTypeId:"feed",quantity:.5,frequency:"monthly",timesPerMonth:7}];s.mealTypes[0].autoFeedingFrom="2026-10-01";
 s=consumeScheduledFeeding(s,"2026-10-07");assert.equal(s.mealTypes[0].currentStock,100);
 assert.equal(horseCost(s,s.horses[0],"2026-10").food,17.5);
});
test("large backlogs catch up in bounded idempotent batches without skipping feeding days",()=>{
 let s=fixture();s.mealTypes[0].autoFeedingFrom="2026-10-01";
 s=consumeScheduledFeeding(s,"2026-10-31");assert.equal(s.mealTypes[0].autoFeedingThrough,"2026-10-07");
 for(let i=0;i<4;i++)s=consumeScheduledFeeding(s,"2026-10-31");
 assert.equal(s.mealTypes[0].currentStock,38);assert.equal(s.inventoryTransactions.length,31);
 assert.equal(new Set(s.inventoryTransactions.map(t=>t.id)).size,31);
 assert.deepEqual(consumeScheduledFeeding(s,"2026-10-31"),s);
});
test("activated item unit changes are refused without modifying the existing balance",()=>{
 const s=run(fixture(),"stock.reconcile",{actualQuantity:100,reason:"جرد",activate:true});
 assert.throws(()=>run(s,"meal.save",{...s.mealTypes[0],unit:"كيس",feedingUnit:"كجم",feedingUnitsPerPurchaseUnit:40},"feed","2026-10-18T12:00:00Z","change_units"));
 assert.equal(s.mealTypes[0].currentStock,100);assert.equal(s.mealTypes[0].unit,"كجم");
});
