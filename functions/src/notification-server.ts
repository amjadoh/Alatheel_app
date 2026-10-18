import { createHash } from "node:crypto";
import { getMessaging } from "firebase-admin/messaging";
import { Timestamp, type Firestore, type Transaction } from "firebase-admin/firestore";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { onDocumentCreated, onDocumentWritten } from "firebase-functions/v2/firestore";
import { emptyState, ensure, type State, type Collection } from "./domain";
import { normalizeRecord, storageCollection } from "./records";
import { consumeScheduledFeeding } from "./feeding-stock";
import { previousFeedingDay } from "./feeding";
import { collectionDueAlerts, stockAlert, eligibleStaff, pushCopy, riyadhClock, type StaffAlert } from "./alerts";
import { resolveAccess } from "./access";
import { sessionExpiresAt } from "./session-policy";

const digest = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 40);
export function notificationFunctions(db: Firestore, databaseId: string, options: {region:string;maxInstances:number}, verify: (request:any)=>Promise<any>) {
  async function readState(tx: Transaction, names: Collection[]) {
    const state=emptyState();
    for(const name of names){const snap=await tx.get(db.collection(storageCollection(name)).limit(4001));ensure(snap.size<=4000,"يلزم ترقية حجم السجلات قبل المزامنة");state[name]=snap.docs.map(d=>normalizeRecord(name,d.id,d.data()));}
    return state;
  }
  function saveChanges(tx:Transaction,before:State,after:State,names:Collection[]){
    let count=0;
    for(const name of names){const old=new Map(before[name].map(x=>[x.id,JSON.stringify(x)]));for(const row of after[name])if(old.get(row.id)!==JSON.stringify(row)){count++;const{id,...data}=row;for(const k of ["createdAt","updatedAt"])if(typeof data[k]==="string")data[k]=Timestamp.fromDate(new Date(data[k]));tx.set(db.doc(`${storageCollection(name)}/${id}`),data);}}
    ensure(count<=450,"حجم المزامنة يحتاج تقسيمًا؛ لم تُحفظ حركة جزئية");
  }
  function createAlerts(tx:Transaction,alerts:StaffAlert[],users:State["users"],now:string){
    // Event IDs are deterministic, and the event marker is written atomically with all recipient alerts.
    for(const alert of alerts)for(const u of users.filter(eligibleStaff)){
      const id=digest(alert.key);tx.create(db.doc(`users/${u.id}/staffAlerts/${id}`),{...alert,userId:u.id,read:false,createdAt:now,deliveryState:"pending"});
    }
  }
  async function evaluateInventory(mealId?:string){
    const now=new Date().toISOString();
    await db.runTransaction(async tx=>{
      const state=await readState(tx,["mealTypes","users"]);
      const meals=state.mealTypes.filter(m=>!mealId||m.id===mealId);
      const old=await Promise.all(meals.map(m=>tx.get(db.doc(`stockAlertState/${m.id}`))));
      const events:StaffAlert[]=[];
      for(let i=0;i<meals.length;i++){
        const next=stockAlert(meals[i],old[i].exists?old[i].data() as any:undefined);
        if(JSON.stringify(old[i].data())!==JSON.stringify(next.state))tx.set(old[i].ref,next.state);
        if(next.alert)events.push(next.alert);
      }
      ensure(events.length*state.users.filter(eligibleStaff).length+meals.length<=450,"حجم تنبيهات المخزون يحتاج تقسيمًا");
      createAlerts(tx,events,state.users,now);
    });
  }
  async function sweepFeeding(){
    const now=new Date().toISOString(),today=riyadhClock(now).day;
    await db.runTransaction(async tx=>{
      const before=await readState(tx,["horses","mealTypes","inventoryTransactions"]);
      const after=consumeScheduledFeeding(before,previousFeedingDay(today),now);
      saveChanges(tx,before,after,["mealTypes","inventoryTransactions"]);
    });
  }
  const updatePushDevice=onCall(options,async request=>{
    const {identity}=await verify(request),uid=request.auth!.uid;
    const {deviceId,token,enabled,action,kinds}=request.data||{};
    ensure(typeof deviceId==="string"&&/^[A-Za-z0-9_-]{16,100}$/.test(deviceId),"معرف الجهاز غير صالح");
    await db.runTransaction(async tx=>{
      const profile=await tx.get(db.doc(`users/${uid}`));resolveAccess(identity,profile.data());
      ensure(profile.exists&&eligibleStaff({...profile.data(),id:profile.id} as any),"الإشعارات متاحة للمدير والموظف فقط");
      const ref=db.doc(`pushDevices/${deviceId}`),old=await tx.get(ref);
      if(action==="remove") {if(old.data()?.userId===uid)tx.delete(ref);return;}
      ensure(typeof token==="string"&&token.length>=20&&token.length<=4096,"تعذر تسجيل إشعارات الجهاز");
      const devices=await tx.get(db.collection("pushDevices").where("userId","==",uid).limit(11));
      ensure(old.data()?.userId===uid||devices.size<10,"وصل الحساب إلى الحد الأقصى للأجهزة");
      const allowed=["collection_due","stock_low","stock_empty"];
      ensure(kinds===undefined||Array.isArray(kinds)&&kinds.every((k:any)=>allowed.includes(k)),"أنواع الإشعارات غير صالحة");
      tx.set(ref,{userId:uid,token,enabled:enabled===true,kinds:kinds||old.data()?.kinds||allowed,sessionExpiresAt:sessionExpiresAt(request.auth!.token.auth_time),updatedAt:new Date().toISOString()});
    });return{ok:true};
  });
  const synchronizeFeeding=onSchedule({...options,schedule:"5 * * * *",timeZone:"Asia/Riyadh",retryCount:3},async()=>{await sweepFeeding();await evaluateInventory();});
  const remindCollections=onSchedule({...options,schedule:"0 21 * * *",timeZone:"Asia/Riyadh",retryCount:3},async()=>{
    const now=new Date().toISOString(),clock=riyadhClock(now);if(clock.hour<21)return;
    await db.runTransaction(async tx=>{
      const state=await readState(tx,["horses","expenses","income","users"]);
      const planned=collectionDueAlerts(state,clock.day);
      const markers=await Promise.all(planned.map(a=>tx.get(db.doc(`staffAlertEvents/${digest(a.key)}`))));
      const fresh=planned.filter((_,i)=>!markers[i].exists);
      ensure(fresh.length*(state.users.filter(eligibleStaff).length+1)<=450,"حجم تنبيهات التحصيل يحتاج تقسيمًا");
      fresh.forEach(a=>tx.create(db.doc(`staffAlertEvents/${digest(a.key)}`),{createdAt:now,key:a.key}));
      createAlerts(tx,fresh,state.users,now);
    });
  });
  const inventoryAlert=onDocumentWritten({...options,database:databaseId,document:"mealTypes/{mealId}"},async event=>{if(event.data?.after.exists)await evaluateInventory(event.params.mealId);});
  const deliverStaffAlert=onDocumentCreated({...options,database:databaseId,document:"users/{userId}/staffAlerts/{alertId}",retry:true},async event=>{
    if(!event.data)return;
    const ref=event.data.ref,now=Date.now();
    const alert=await db.runTransaction(async tx=>{
      const [snap,p]=await Promise.all([tx.get(ref),tx.get(db.doc(`users/${event.params.userId}`))]);
      if(!snap.exists||["sent","cancelled"].includes(snap.data()?.deliveryState)||!eligibleStaff({...p.data(),id:p.id} as any))return null;
      if(snap.data()?.deliveryState==="sending"&&snap.data()?.leaseUntil>now)throw new Error("Notification delivery is leased");
      const a=snap.data()!;ensure(["collection_due","stock_low","stock_empty"].includes(a.kind),"Invalid alert kind");
      let relevant=true;
      if(a.kind==="collection_due"){
        const current=await readState(tx,["horses","expenses","income"]);
        relevant=collectionDueAlerts(current,riyadhClock(new Date().toISOString()).day).some(x=>x.key===a.key);
      }else{
        const current=await tx.get(db.doc(`mealTypes/${a.mealTypeId}`));
        const phase=await tx.get(db.doc(`stockAlertState/${a.mealTypeId}`));
        relevant=current.exists&&phase.exists&&a.key===`stock_${a.mealTypeId}_${phase.data()?.phase}_${phase.data()?.sequence}`;
      }
      if(!relevant){tx.update(ref,{deliveryState:"cancelled",leaseUntil:0});return null;}
      tx.update(ref,{deliveryState:"sending",leaseUntil:now+120000});return a;
    });
    if(!alert)return;
    try{
      const devices=await db.collection("pushDevices").where("userId","==",event.params.userId).get();
      const selected=devices.docs.filter(d=>d.data().enabled===true&&d.data().sessionExpiresAt>Date.now()&&(!d.data().kinds||d.data().kinds.includes(alert.kind)));
      if(selected.length){
        const copy=pushCopy(alert.kind);
        const result=await getMessaging().sendEachForMulticast({tokens:selected.map(d=>d.data().token),data:{...copy,alertId:event.params.alertId,userId:event.params.userId,kind:alert.kind},android:{priority:"high",ttl:alert.kind==="collection_due"?3*3600000:24*3600000,collapseKey:event.params.alertId}});
        const deletes:Promise<any>[]=[];let transient=false;
        result.responses.forEach((r,i)=>{if(!r.success){const code=r.error?.code||"";if(["messaging/registration-token-not-registered","messaging/invalid-registration-token"].includes(code))deletes.push(selected[i].ref.delete());else transient=true;}});
        await Promise.all(deletes);if(transient)throw new Error("Temporary messaging failure");
      }
      await ref.update({deliveryState:"sent",deliveredAt:new Date().toISOString(),leaseUntil:0});
    }catch(error){await ref.update({deliveryState:"pending",leaseUntil:0});throw error;}
  });
  return {updatePushDevice,synchronizeFeeding,remindCollections,inventoryAlert,deliverStaffAlert};
}
