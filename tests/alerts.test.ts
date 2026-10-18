import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyState } from "../functions/src/domain";
import { collectionDueAlerts, stockAlert, eligibleStaff, riyadhClock, pushCopy } from "../functions/src/alerts";
import { assertSession, sessionExpiresAt } from "../functions/src/session-policy";
test("collection reminders use Saudi21:00 and only the unpaid amount due today", () => {
  const s=emptyState();s.horses=[{id:"h",name:"خيل",status:"boarding",entryDate:"2026-10-01",dueDate:"2026-10-18",boardingFee:700}];
  assert.deepEqual(riyadhClock("2026-10-18T18:00:00Z"),{day:"2026-10-18",hour:21});
  assert.equal(collectionDueAlerts(s,"2026-10-17").length,0);
  assert.equal(collectionDueAlerts(s,"2026-10-18")[0].amount,700);
  s.income=[{id:"r",horseId:"h",accountVersion:1,amount:300,collectedAt:"2026-10-18",allocations:[{id:"boarding_2026-10-18",amount:300}]}];
  assert.equal(collectionDueAlerts(s,"2026-10-18")[0].amount,400);
  s.income[0].amount=900;s.income[0].allocations[0].amount=700;
  assert.equal(collectionDueAlerts(s,"2026-10-18").length,0);
  s.horses[0].status="private";s.income=[];
  assert.equal(collectionDueAlerts(s,"2026-10-18").length,0);
});
test("stock low and empty notify on downward transitions once and rearm after replenishment",()=>{
  const meal={id:"m",name:"رودس",unit:"كجم",currentStock:65,minThreshold:20};
  let result=stockAlert(meal);assert.equal(result.alert,undefined);
  meal.currentStock=20;result=stockAlert(meal,result.state);assert.equal(result.alert?.kind,"stock_low");
  const lowKey=result.alert?.key;result=stockAlert(meal,result.state);assert.equal(result.alert,undefined);
  meal.currentStock=-2;result=stockAlert(meal,result.state);assert.equal(result.alert?.kind,"stock_empty");
  result=stockAlert(meal,result.state);assert.equal(result.alert,undefined);
  meal.currentStock=100;result=stockAlert(meal,result.state);assert.equal(result.alert,undefined);
  meal.currentStock=10;result=stockAlert(meal,result.state);assert.notEqual(result.alert?.key,lowKey);
});
test("only approved enabled staff receive alerts; push does not expose financial details",()=>{
  for(const role of ["admin","employee"])assert.ok(eligibleStaff({id:role,role,disabled:false,membershipApproved:true}));
  for(const role of ["owner","viewer"])assert.ok(!eligibleStaff({id:role,role,disabled:false,membershipApproved:true}));
  assert.ok(!eligibleStaff({id:"x",role:"admin",disabled:true,membershipApproved:true}));
  assert.ok(!eligibleStaff({id:"x",role:"employee",disabled:false,membershipApproved:false}));
  assert.ok(!pushCopy("collection_due").body.includes("700"));
});
test("seven day session expires exactly at seven days rather than on a token refresh",()=>{
  const authTime=Date.parse("2026-10-18T18:00:00Z")/1000;
  assert.equal(sessionExpiresAt(authTime),Date.parse("2026-10-25T18:00:00Z"));
  assert.doesNotThrow(()=>assertSession(authTime,sessionExpiresAt(authTime)-1));
  assert.throws(()=>assertSession(authTime,sessionExpiresAt(authTime)),/7 أيام/);
  assert.throws(()=>assertSession(undefined));
});
