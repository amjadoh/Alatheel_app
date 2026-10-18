import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyState } from "../functions/src/domain";
import { collectionDueAlerts, stockAlert, eligibleStaff, eligiblePushUser, allowedAlertKinds, appUpdateAlert, deliveryDecision, deviceWantsAlert, riyadhClock, pushCopy } from "../functions/src/alerts";
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
const release={packageId:"com.alatheel.stable",versionName:"1.8.1",versionCode:10,url:"https://alatheel-app-426403695200.web.app/downloads/Alatheel-1.8.1.apk",sha256:"a".repeat(64),size:7687602};
test("release announcements have a stable per-version identity and reject untrusted or incomplete manifests",()=>{
 const a=appUpdateAlert(release);assert.equal(a.key,"release_10");assert.equal(a.page,"update");assert.deepEqual(appUpdateAlert({...release}),a);
 for(const value of [{...release,url:"https://evil.test/app.apk"},{...release,sha256:"bad"},{...release,size:0},{...release,versionCode:9},{...release,packageId:"other"}])assert.throws(()=>appUpdateAlert(value));
});
test("all approved members may receive updates while only staff may receive financial or stock alerts",()=>{
 for(const role of ["admin","employee","owner","viewer"]){const u={id:role,role,disabled:false,membershipApproved:true};assert.ok(eligiblePushUser(u));assert.ok(allowedAlertKinds(u).includes("app_update"));assert.equal(allowedAlertKinds(u).includes("collection_due"),["admin","employee"].includes(role));}
 assert.deepEqual(allowedAlertKinds({id:"x",role:"owner",disabled:true,membershipApproved:true}),[]);
 assert.deepEqual(allowedAlertKinds({id:"x",role:"admin",disabled:false,membershipApproved:false}),[]);
});
test("update pushes exclude current/newer installs, expired sessions and disabled preferences",()=>{
 const alert=appUpdateAlert(release),device={id:"d",enabled:true,sessionExpiresAt:2000,kinds:["app_update"],installedVersionCode:9};
 assert.equal(deviceWantsAlert(device,alert,1000),true);
 for(const patch of [{installedVersionCode:10},{installedVersionCode:11},{enabled:false},{sessionExpiresAt:1000},{kinds:["stock_low"]}])assert.equal(deviceWantsAlert({...device,...patch},alert,1000),false);
});
test("delivery attempts stop after three claims or 24h, and concurrent workers respect the lease",()=>{
 const now=Date.parse("2026-10-18T12:00:00Z"),row={id:"x",createdAt:"2026-10-18T11:00:00Z",deliveryState:"pending",deliveryAttempts:0};
 for(let attempts=0;attempts<3;attempts++)assert.equal(deliveryDecision({...row,deliveryAttempts:attempts},now),"ready");
 assert.equal(deliveryDecision({...row,deliveryAttempts:3},now),"limit");
 assert.equal(deliveryDecision({...row,deliveryState:"sending",leaseUntil:now+1},now),"leased");
 assert.equal(deliveryDecision({...row,deliveryState:"sending",leaseUntil:now-1},now),"ready");
 assert.equal(deliveryDecision(row,Date.parse(row.createdAt)+86400000),"expired");
 assert.equal(deliveryDecision({...row,deliveryState:"sent"},now),"done");
});
