// Run only against the isolated Firestore emulator. No real credentials or production writes.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createRequire}=require('node:module');
const qa=createRequire(path.resolve(process.env.QA_BACKEND_MODULES,'_qa.cjs'));
const {initializeTestEnvironment,assertSucceeds,assertFails}=qa('@firebase/rules-unit-testing');
const {doc,setDoc,getDoc,updateDoc,deleteDoc,Timestamp}=qa('firebase/firestore');
async function main(){
 assert.ok(process.env.FIRESTORE_EMULATOR_HOST,'Firestore emulator is required');
 const projectId='demo-alatheel';
 const env=await initializeTestEnvironment({projectId,firestore:{rules:fs.readFileSync('firestore.rules','utf8')}});
 try{
  await env.clearFirestore();
  const stamp=Timestamp.fromDate(new Date('2026-10-18T12:00:00Z'));
  const staff={email:'staff@example.test',role:'admin',disabled:false,membershipApproved:true};
  await env.withSecurityRulesDisabled(async ctx=>{
   const db=ctx.firestore();
   await Promise.all([
    setDoc(doc(db,'users/staff'),staff),
    setDoc(doc(db,'users/other'),{...staff,email:'other@example.test',role:'employee'}),
    setDoc(doc(db,'users/owner'),{...staff,email:'owner@example.test',role:'owner'}),
    setDoc(doc(db,'users/disabled'),{...staff,email:'disabled@example.test',disabled:true}),
    setDoc(doc(db,'users/staff/staffAlerts/event'),{read:false,title:'test'}),
    setDoc(doc(db,'users/other/staffAlerts/event'),{read:false,title:'other'}),
    setDoc(doc(db,'users/owner/staffAlerts/update'),{read:false,title:'new app',kind:'app_update'}),
    setDoc(doc(db,'users/owner/staffAlerts/former-staff-alert'),{read:false,title:'private finance',kind:'collection_due'}),
    setDoc(doc(db,'mealTypes/feed'),{name:'feed',unit:'kg',pricePerUnit:2,currentStock:10,minThreshold:3,autoFeedingFrom:'2026-10-19'}),
    setDoc(doc(db,'horses/horse'),{name:'horse',ownerId:'owner',status:'private',feedingHistory:[],feeding:[],createdAt:stamp,updatedAt:stamp}),
    setDoc(doc(db,'incomes/locked_legacy'),{horseId:'horse',horseName:'horse',ownerId:'owner',amount:100,status:'void',dueDate:stamp,collectedAt:stamp,receiptAuditLocked:true}),
    setDoc(doc(db,'incomes/modern_receipt'),{horseId:'horse',horseName:'horse',ownerId:'owner',amount:100,status:'collected',dueDate:stamp,collectedAt:stamp,accountVersion:1}),
    setDoc(doc(db,'appFeedback/sample'),{text:'private note',syncState:'queued'}),
    setDoc(doc(db,'appFeedback/sample/files/0/chunks/0'),{base64:'c2FtcGxl'})
   ]);
  });
  const context=uid=>env.authenticatedContext(uid,{email:uid+'@example.test',email_verified:true,firebase:{sign_in_provider:'google.com'}}).firestore();
  const staffDB=context('staff'),ownerDB=context('owner'),otherDB=context('other'),disabledDB=context('disabled');
  for(const db of [staffDB,otherDB,ownerDB]) for(const id of ['locked_legacy','modern_receipt']) {
    await assertFails(updateDoc(doc(db,'incomes/'+id),{amount:900,status:'collected'}));
    await assertFails(deleteDoc(doc(db,'incomes/'+id)));
  }
  await assertFails(setDoc(doc(staffDB,'incomes/forged_adjustment'),{horseId:'horse',amount:100,status:'collected',dueDate:stamp,reversalAt:'2026-10-20T09:00:00Z'}));
  await assertSucceeds(getDoc(doc(staffDB,'appFeedback/sample')));
  for(const db of [otherDB,ownerDB,disabledDB]) await assertFails(getDoc(doc(db,'appFeedback/sample')));
  for(const db of [staffDB,otherDB,ownerDB]){
    await assertFails(setDoc(doc(db,'appFeedback/forged'),{text:'forged'}));
    await assertFails(updateDoc(doc(db,'appFeedback/sample'),{issueUrl:'forged'}));
    await assertFails(getDoc(doc(db,'appFeedback/sample/files/0/chunks/0')));
    await assertFails(setDoc(doc(db,'feedbackUsage/forged'),{count:0}));
  }
  await assertSucceeds(getDoc(doc(staffDB,'users/staff/staffAlerts/event')));
  await assertSucceeds(updateDoc(doc(staffDB,'users/staff/staffAlerts/event'),{read:true}));
  await assertFails(updateDoc(doc(staffDB,'users/staff/staffAlerts/event'),{title:'changed'}));
  await assertFails(setDoc(doc(staffDB,'users/staff/staffAlerts/forged'),{read:false}));
  await assertFails(getDoc(doc(otherDB,'users/staff/staffAlerts/event')));
  await assertFails(getDoc(doc(ownerDB,'users/staff/staffAlerts/event')));
  await assertFails(getDoc(doc(disabledDB,'users/staff/staffAlerts/event')));
  await assertSucceeds(getDoc(doc(ownerDB,'users/owner/staffAlerts/update')));
  await assertFails(getDoc(doc(ownerDB,'users/owner/staffAlerts/former-staff-alert')));
  await assertSucceeds(updateDoc(doc(ownerDB,'users/owner/staffAlerts/update'),{read:true}));
  await assertFails(setDoc(doc(ownerDB,'users/owner/staffAlerts/forged'),{kind:'app_update'}));
  for(const collection of ['pushDevices','stockAlertState','staffAlertEvents','appUpdateState'])await assertFails(setDoc(doc(staffDB,collection+'/forged'),{userId:'staff'}));
  await assertFails(updateDoc(doc(staffDB,'mealTypes/feed'),{currentStock:99}));
  await assertFails(updateDoc(doc(staffDB,'mealTypes/feed'),{autoFeedingFrom:'2026-01-01'}));
  await assertSucceeds(updateDoc(doc(staffDB,'mealTypes/feed'),{minThreshold:4}));
  await assertFails(setDoc(doc(staffDB,'inventoryTransactions/feeding_feed_2026-10-19'),{movementKind:'manual'}));
  await assertFails(setDoc(doc(staffDB,'inventoryTransactions/forged'),{movementKind:'feeding',feedingDate:'2026-10-19'}));
  await assertFails(updateDoc(doc(staffDB,'horses/horse'),{feeding:[],feedingHistory:[{from:'2026-01-01'}]}));
  await assertFails(updateDoc(doc(staffDB,'horses/horse'),{status:'archived'}));
  await assertSucceeds(updateDoc(doc(staffDB,'users/staff'),{displayName:'updated'}));
  console.log('PASS staff inbox isolation, revoked access, protected automatic stock and feeding history, and server-only push records');
 }finally{await env.cleanup();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
