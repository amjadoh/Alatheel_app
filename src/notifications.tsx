import { useEffect,useRef,useState } from "react";
import { collection,query,orderBy,limit,onSnapshot,doc,getDoc,updateDoc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { App as NativeApp } from "@capacitor/app";
import { Bell,Wallet,Package,AlertCircle } from "lucide-react";
import { getNotificationServices,staff,errorText,type Actor } from "./service";
import { androidPush,StaffPush,pushDeviceId,type PushOpen } from "./native-push";
import { displayDate,displayNumber } from "./format";
export type StaffAlert={id:string;title:string;body:string;kind:string;read:boolean;createdAt:string;page:"income"|"inventory";horseId?:string;mealTypeId?:string};
const allKinds=["collection_due","stock_low","stock_empty"];
export function useStaffNotifications(actor:Actor|null,onOpen:(target:{page:"income"|"inventory";horseId?:string;mealTypeId?:string})=>void){
 const [alerts,setAlerts]=useState<StaffAlert[]>([]),[enabled,setEnabled]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const [kinds,setKindsState]=useState<string[]>(allKinds),callback=useRef(onOpen),opened=useRef(new Set<string>());callback.current=onOpen;
 const kindsRef=useRef(kinds);kindsRef.current=kinds;
 const uid=actor&&staff(actor)?actor.uid:"";
 const services=getNotificationServices();
 async function register(token:string,selected=kinds){if(!services||!uid)return;await httpsCallable(services.functions,"updatePushDevice")({deviceId:pushDeviceId(),token,enabled:true,kinds:selected});}
 async function open(alert:StaffAlert){if(!uid||!services)return;await updateDoc(doc(services.db,"users",uid,"staffAlerts",alert.id),{read:true}).catch(()=>{});if(["income","inventory"].includes(alert.page))callback.current({page:alert.page,horseId:alert.horseId,mealTypeId:alert.mealTypeId});}
 const openRef=useRef(open);openRef.current=open;
 useEffect(()=>{
  if(!uid||!services){setAlerts([]);return;}
  let alive=true;opened.current.clear();
  let selected=allKinds;try{const saved=JSON.parse(localStorage.getItem("alatheel.push.kinds."+uid)||"null");if(Array.isArray(saved))selected=saved.filter(x=>allKinds.includes(x));}catch{}kindsRef.current=selected;setKindsState(selected);
  const unsub=onSnapshot(query(collection(services.db,"users",uid,"staffAlerts"),orderBy("createdAt","desc"),limit(100)),snap=>{if(alive)setAlerts(snap.docs.map(d=>({id:d.id,...d.data()} as StaffAlert)));},e=>{if(alive)setError(errorText(e));});
  async function handle(value:PushOpen){if(!alive||value.userId!==uid||!value.alertId||opened.current.has(value.alertId))return;opened.current.add(value.alertId);try{const snap=await getDoc(doc(services!.db,"users",uid,"staffAlerts",value.alertId));if(alive&&snap.exists())await openRef.current({id:snap.id,...snap.data()} as StaffAlert);}catch{opened.current.delete(value.alertId);}}
  async function sync(){if(!alive||!androidPush)return;try{await StaffPush.session({userId:uid,deviceId:pushDeviceId()});const status=await StaffPush.status();if(alive)setEnabled(status.enabled);if(status.enabled){const result=await StaffPush.token();if(alive&&result.token)await register(result.token,kindsRef.current);}await handle(await StaffPush.pending());}catch(e){if(alive)setError(errorText(e));}}
  let removeNative:undefined|(()=>void),removeResume:undefined|(()=>void);
  if(androidPush){void StaffPush.addListener("open",v=>void handle(v)).then(h=>{if(alive)removeNative=()=>void h.remove();else void h.remove();});void NativeApp.addListener("appStateChange",({isActive})=>{if(isActive)void sync();}).then(h=>{if(alive)removeResume=()=>void h.remove();else void h.remove();});void sync();}
  return()=>{alive=false;unsub();removeNative?.();removeResume?.();};
 },[uid,services?.db,services?.functions]);
 async function enable(){if(!androidPush||!uid)return;setBusy(true);setError("");try{await StaffPush.session({userId:uid,deviceId:pushDeviceId()});const result=await StaffPush.enable();if(!result.enabled||!result.token)throw new Error("اسمح بإشعارات الأثيل من إعدادات الجوال ثم أعد المحاولة");await register(result.token);setEnabled(true);}catch(e){setError(errorText(e));}finally{setBusy(false);}}
 async function disable(){setBusy(true);setError("");try{await StaffPush.disable();if(services)await httpsCallable(services.functions,"updatePushDevice")({action:"remove",deviceId:pushDeviceId()});setEnabled(false);}catch(e){setEnabled(false);setError(errorText(e));}finally{setBusy(false);}}
 async function setKinds(next:string[]){kindsRef.current=next;setKindsState(next);try{localStorage.setItem("alatheel.push.kinds."+uid,JSON.stringify(next));if(enabled){const result=await StaffPush.token();await register(result.token,next);}}catch(e){setError(errorText(e));}}
 return{alerts,unread:alerts.filter(x=>!x.read).length,enabled,busy,error,enable,disable,open,kinds,setKinds};
}
export function NotificationsPanel({notifications:n}:{notifications:ReturnType<typeof useStaffNotifications>}){return <section className="notification-page" dir="rtl"><div className="card"><div className="spread"><h2>تنبيهاتك</h2><span className="pill">المدير والموظف</span></div><p className="muted small">يوم استحقاق التحصيل · {displayNumber(9)} مساءً بتوقيت السعودية</p>{[["collection_due","استحقاق التحصيل"],["stock_low","انخفاض المخزون"],["stock_empty","نفاد المخزون"]].map(([id,label])=><label className="notification-toggle" key={id}><span>{label}</span><input type="checkbox" checked={n.kinds.includes(id)} onChange={e=>void n.setKinds(e.target.checked?[...n.kinds,id]:n.kinds.filter(x=>x!==id))}/></label>)}{androidPush&&<button className="button gold" disabled={n.busy} onClick={()=>void(n.enabled?n.disable():n.enable())}><Bell size={18}/>{n.enabled?"إيقاف إشعارات هذا الجهاز":"تفعيل إشعارات هذا الجهاز"}</button>}{n.error&&<p className="notice error" role="alert">{n.error}</p>}</div><div className="card"><h2>الإشعارات</h2>{!n.alerts.length&&<p className="muted">لا توجد إشعارات حتى الآن</p>}{n.alerts.map(a=><button className={`notification-row ${a.read?"":"unread"}`} key={a.id} onClick={()=>void n.open(a)}>{a.kind==="collection_due"?<Wallet size={20}/>:a.kind==="stock_low"?<Package size={20}/>:<AlertCircle size={20}/>}<span><b>{a.title}</b><span>{a.body}</span><small>{displayDate(a.createdAt)}</small></span></button>)}</div></section>;}
