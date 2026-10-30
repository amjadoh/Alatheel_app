// Used exclusively by vite.qa.config.ts, never by the production build.
import {
  emptyState,
  applyCommand,
  type State,
  type Actor,
} from "../../functions/src/domain";
import { accountRevision } from "../../functions/src/accounts";
import { horseFinance } from "../../functions/src/finance";
import { businessDay } from "../../functions/src/dates";
import { consumeScheduledFeeding } from '../../functions/src/feeding-stock';
export { staff, bill, money, nextMonth } from "../../functions/src/domain";
export type {
  Actor,
  State,
  Row,
  Command,
  Role,
} from "../../functions/src/domain";
let s = emptyState();
const feedbackFixtureServices={db:{}};
export function getNotificationServices(){return new URLSearchParams(location.search).get('scenario')==='feedback-status'?feedbackFixtureServices as any:null as any;}
const qaFeedback = new Map<string,any>(), qaFeedbackCalls: any[] = [];
export const feedbackListeners=new Set<()=>void>();
export const feedbackNotes=()=>[...qaFeedback.values()];
if(new URLSearchParams(location.search).get('scenario')==='feedback-status') {
  qaFeedback.set('status_ui_fixture',{id:'status_ui_fixture',text:'بلاغ اختبار حالة GitHub',files:[],createdByName:'مدير تجريبي',createdAt:'2026-10-30T00:00:00Z',version:'1.13.0',syncState:'synced',status:'new',emailState:'disabled'});
  (window as any).__feedbackStatusComplete=(state:string)=>{qaFeedback.get('status_ui_fixture').statusSyncState=state;feedbackListeners.forEach(fn=>fn());};
}
let lostFeedbackAcknowledgement=false;
(window as any).__feedbackQA=()=>({notes:[...qaFeedback.values()].map(n=>({id:n.id,syncState:n.syncState,files:n.files})),calls:qaFeedbackCalls.map(c=>({action:c.action,id:c.id,file:c.file,chunk:c.chunk}))});
export async function feedbackCommand(data:Record<string,any>){
  if(!['feedback','feedback-status'].includes(new URLSearchParams(location.search).get("scenario")||''))throw new Error("المزامنة مع المستودع غير مفعلة في بيانات الفحص المحلية");
  if(a.role!=="admin")throw new Error("للمدير فقط");
  qaFeedbackCalls.push(data);
  if(data.action==="create"){
    if(!qaFeedback.has(data.id))qaFeedback.set(data.id,{...data,syncState:"draft"});
    return {ok:true,syncState:qaFeedback.get(data.id).syncState};
  }
  const note=qaFeedback.get(data.id);if(!note)throw new Error("ملاحظة مفقودة");
  if(data.action==='status'){Object.assign(note,{status:data.status,resolution:data.resolution||'',statusSyncState:'queued'});feedbackListeners.forEach(fn=>fn());return{ok:true};}
  if(data.action==="upload"){if(note.syncState!=="draft")throw new Error("الملاحظة مرسلة");return{ok:true};}
  if(data.action==="submit"){
    note.syncState="queued";
    if(!lostFeedbackAcknowledgement){lostFeedbackAcknowledgement=true;throw new Error("انقطع تأكيد الشبكة التجريبي بعد حفظ الملاحظة");}
    return{ok:true};
  }
  return{ok:true};
}
const a: Actor = {
  uid: "qa",
  displayName: "مدير تجريبي",
  role: "admin",
  dataReady: true,
};
s.settings = [{ id: "main", stableName: "الأثيل · فحص محلي" }];
s.users = [
  {
    id: "qa",
    displayName: a.displayName,
    email: "qa@example.test",
    role: "admin",
  },
];
if(new URLSearchParams(location.search).get("primary")==="1")s.users[0].email="amjadoh@gmail.com";
if (new URLSearchParams(location.search).get("scenario") === "primary-notifications") {
  s.users = [
    { id: "qa", displayName: a.displayName, email: "amjadoh@gmail.com", role: "admin", disabled: false, membershipApproved: true },
    { id: "employee", displayName: "موظف تجريبي", email: "employee@example.test", role: "employee", disabled: false, membershipApproved: true },
    { id: "owner-user", displayName: "مالك تجريبي", email: "owner@example.test", role: "owner", disabled: false, membershipApproved: true },
    { id: "disabled", displayName: "عضو معطل", email: "disabled@example.test", role: "viewer", disabled: true, membershipApproved: true },
  ];
}
s.owners = [{ id: "owner", displayName: "مالك تجريبي" }];
s.mealTypes = [
  {
    id: "feed",
    name: "مركزات",
    unit: "كيس 40 كجم",
    pricePerUnit: 80,
    currentStock: 5,
    minThreshold: 1,
  },
];
s.horses = [
  {
    id: "horse",
    name: "خيل تجريبي",
    ownerId: "owner",
    ownerName: "مالك تجريبي",
    entryDate: "2026-06-01",
    dueDate: "2026-09-20",
    status: "boarding",
    boardingFee: 700,
    feeding: [{ mealTypeId: "feed", quantity: 3 }],
  },
  {
    id: "private",
    name: "خيل ملك خاص تجريبي",
    ownerId: "qa",
    ownerName: "الإسطبل",
    entryDate: "2026-10-01",
    status: "private",
    boardingFee: 0,
    feeding: [{ mealTypeId: "feed", quantity: 3 }],
  },
];
s.expenses = [
  {
    id: "salary",
    name: "راتب العامل",
    cost: 1800,
    frequency: "monthly",
    expenseCategory: "salary",
    expenseKind: "operating",
    allocationScope: "all_active",
  },
  {
    id: "vet",
    name: "زيارة طبيب",
    cost: 300,
    frequency: "once",
    incurredAt: "2026-10-16",
    expenseKind: "operating",
    expenseCategory: "other",
    allocationScope: "all_active",
    chargedTo: "stable",
  },
];
if (new URLSearchParams(location.search).get("scenario") === "inventory-plan") {
  s.mealTypes = [
    {id:"rhodes",name:"الرودس",unit:"ربطة",currentStock:10,pricePerUnit:30,minThreshold:2},
    {id:"feed",name:"المركزات",unit:"كيس 40 كجم",currentStock:4.75,pricePerUnit:80,minThreshold:1},
    {id:"extra",name:"صنف إضافي",unit:"كجم",currentStock:5,pricePerUnit:18,minThreshold:1},
  ];
  s.horses = Array.from({length:8},(_,i)=>({id:`h${i}`,name:`خيل تجريبي ${i+1}`,status:"private",entryDate:"2026-09-01",feeding:[
    {mealTypeId:"rhodes",quantity:.2,frequency:"daily"},
    {mealTypeId:"feed",quantity:2,frequency:"daily"},
    {mealTypeId:"extra",quantity:.5,frequency:"monthly",timesPerMonth:2,schedule:[{weekday:2,ordinal:3},{weekday:0,ordinal:4}]},
  ]}));
}
if (
  new URLSearchParams(location.search).get("scenario") === "closed-expenses"
) {
  s = applyCommand(
    s,
    a,
    { action: "finance.rollover", requestId: "qa_september" },
    "2026-09-16T12:00:00Z",
  );
  s = applyCommand(
    s,
    a,
    {
      action: "expense.save",
      id: "salary",
      requestId: "qa_october_change",
      data: {
        ...s.expenses[0],
        name: "تشغيل جديد",
        cost: 2000,
        expenseCategory: "other",
        chargedTo: "stable",
      },
    },
    "2026-10-16T12:00:00Z",
  );
}
if (new URLSearchParams(location.search).get("scenario") === "follow-up") {
  // Real command-generated receipts and payments, isolated in memory. The test
  // freezes the browser at 2026-10-21; no production service is involved.
  s = emptyState();
  s.settings = [{id:"main", stableName:"الأثيل · فحص المتابعة"}];
  s.users = [{id:a.uid, displayName:a.displayName, email:"qa@example.test", role:"admin"}];
  s.owners = [{id:"owner", displayName:"مالك تجريبي"}];
  s.mealTypes = [{id:"rhodes", name:"الرودس", unit:"ربطة", feedingUnit:"ربطة", feedingUnitsPerPurchaseUnit:1, pricePerUnit:30, currentStock:0, minThreshold:1}];
  const common = {ownerId:"owner", ownerName:"مالك تجريبي", status:"boarding", entryDate:"2026-10-01", feeding:[{mealTypeId:"rhodes",quantity:.2,frequency:"daily"}]};
  s.horses = [
    {id:"overdue",name:"خيل دفعة جزئية",...common,boardingFee:1000,dueDate:"2026-10-20"},
    {id:"due-today",name:"خيل استحقاق اليوم",...common,boardingFee:800,dueDate:"2026-10-21"},
    {id:"prepaid",name:"خيل دفع مقدم",...common,boardingFee:600,dueDate:"2026-10-26"},
    {id:"private",name:"خيل ملك خاص بلا تغذية",ownerId:"qa",ownerName:"الإسطبل",status:"private",entryDate:"2026-10-01",boardingFee:0,feeding:[]},
  ];
  s.registrationRequests = [{id:"request",horseName:"طلب تجريبي",status:"pending",ownerId:"owner",createdAt:"2026-10-21T09:00:00Z"}];
  const now = "2026-10-21T12:00:00Z";
  let request = 0;
  const command = (action:string,id:string|undefined,data:Record<string,any>) => {
    s = applyCommand(s,a,{action,id,data,requestId:`follow_up_fixture_${++request}`},now);
  };
  command("expense.save",undefined,{name:"راتب العامل",cost:1800,frequency:"monthly",startMonth:"2026-10",expenseKind:"operating",expenseCategory:"salary",allocationScope:"all_active",chargedTo:"stable",horseIds:[]});
  const salaryId = s.expenses.at(-1)!.id;
  command("expense.save",undefined,{name:"زيارة الطبيب",cost:300,frequency:"once",incurredAt:"2026-10-21",expenseKind:"operating",expenseCategory:"other",allocationScope:"selected",chargedTo:"owner",horseIds:["overdue"]});
  const vetId = s.expenses.at(-1)!.id;
  command("stock.purchase","rhodes",{amount:7,total:210,paidAt:"2026-10-21",method:"bank"});
  command("stock.move","rhodes",{type:"remove",amount:5.6,reason:"استهلاك سابق تجريبي موثق"});
  command("expense.pay",salaryId,{amount:600,period:"2026-10",paidAt:"2026-10-21",expectedRemaining:1800});
  command("expense.pay",vetId,{amount:100,period:"2026-10",paidAt:"2026-10-21",expectedRemaining:300});
  for(const [horseId,amount] of [["overdue",250],["prepaid",1000]] as const) {
    command("income.pay",horseId,{amount,paymentType:"partial",paidAt:"2026-10-21",method:"bank",periods:[],expectedRevision:accountRevision(s,s.horses.find(h=>h.id===horseId)!)});
  }
  if(new URLSearchParams(location.search).get("incomplete") === "1") {
    // Historical recurring bill with no saved September basis: the UI must
    // label its cash forecast as incomplete even when the card is collapsed.
    s.expenses.find(expense=>expense.id===salaryId)!.startMonth="2026-09";
  }
}
type StartupProgress = { stage: "session" | "access" | "data" | "maintenance" | "ready"; completed: number; total: number };
let emit: (s: State, a: Actor | null, error?: string, phase?: import("../../src/auth-recovery").AuthPhase, progress?: StartupProgress) => void = () => {};
if(new URLSearchParams(location.search).get('scenario')==='fifo') {
  s=emptyState();s.settings=[{id:'main',stableName:'الأثيل · فحص الدفعات'}];
  s.mealTypes=[{id:'feed',name:'شعير تجريبي',unit:'كجم',feedingUnit:'كجم',feedingUnitsPerPurchaseUnit:1,pricePerUnit:0,currentStock:0,minThreshold:1}];
  s.horses=[{id:'horse',name:'خيل اختبار الدفعات',status:'private',entryDate:'2026-10-16',feeding:[{mealTypeId:'feed',quantity:5,frequency:'daily'}]}];
  s=applyCommand(s,a,{action:'stock.purchase',id:'feed',requestId:'fifo_old_purchase',data:{amount:10,total:100,paidAt:'2026-10-01',method:'cash'}},'2026-10-01T12:00:00Z');
  s=applyCommand(s,a,{action:'stock.move',id:'feed',requestId:'fifo_old_consumption',data:{type:'remove',amount:7,reason:'صرف سابق موثق تجريبي'}},'2026-10-02T12:00:00Z');
  s.mealTypes[0].autoFeedingFrom='2026-10-16';s.mealTypes[0].autoFeedingThrough='2026-10-15';
  (window as any).__fifoQAConsume=()=>{s=consumeScheduledFeeding(s,'2026-10-16','2026-10-17T00:00:00Z');emit(s,a);};
}
export function retryLoginSession() { emit(s,a,undefined,"ready"); }
if(new URLSearchParams(location.search).get("scenario")==="owner-alerts"){
  a.uid="owner";a.ownerRecordId="owner";a.role="owner";a.displayName="مالك تجريبي";
}
if(new URLSearchParams(location.search).get("scenario")==="feedback-employee")a.role="employee";
let lostReceiptAcknowledgement = false;
export const inspectQA = () => structuredClone(s);
(window as any).__alatheelQA = inspectQA;
export function connect(fn: typeof emit) {
  emit = fn;
  const scenario=new URLSearchParams(location.search).get("scenario");
  if(scenario === "startup") {
    const params = new URLSearchParams(location.search);
    const qa = (window as any).__startupQA;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const after = (parameter: string, fallback: number, work: () => void) => {
      const requested = Number(params.get(parameter) ?? fallback);
      timers.push(setTimeout(work, Math.max(0, Number.isFinite(requested) ? requested : fallback)));
    };
    const mark = (name: string) => { if(qa) qa.timings[name] = performance.now(); };
    if (params.get("earlyHorse") === "1") {
      (window as any).__startupExpectedHorseFinance = () => horseFinance(s, s.horses[0], businessDay(new Date().toISOString()).slice(0, 7));
      (window as any).__startupChangePrice = () => {
        s = { ...s, mealTypes: s.mealTypes.map(meal => ({ ...meal, pricePerUnit: Number(meal.pricePerUnit) * 2 })) };
        fn(s, { ...a, dataReady: true }, undefined, "ready", { stage: "ready", completed: 5, total: 5 });
      };
    }
    mark("serviceStarted");
    fn(emptyState(), null, undefined, "restoring", {stage:"session", completed:0, total:5});
    after("authDelay", 120, () => {
      const failure = params.get("authFailure");
      if(failure === "waiting" || failure === "blocked") {
        mark("authFailure");
        fn(emptyState(), null, failure === "waiting" ? "تعذر الاتصال التجريبي" : "تعذر التحقق من صلاحية الحساب التجريبي", failure, {stage:"access", completed:1, total:5});
        return;
      }
      mark("authReady");
      if (params.get("earlyHorse") === "1") {
        mark("earlyHorse");
        fn({ ...emptyState(), horses: s.horses }, { ...a, dataReady: false }, undefined, "ready", { stage: "data", completed: 2, total: 5 });
      } else fn(emptyState(), {...a, dataReady:false}, undefined, "ready", {stage:"data", completed:2, total:5});
    });
    if(!params.get("authFailure")) {
      after("dataDelay", 280, () => {
        mark("dataArrived");
        fn(s, {...a, dataReady:false}, undefined, "ready", {stage:"maintenance", completed:4, total:5});
      });
      after("readyDelay", 420, () => {
        mark("financialReady");
        fn(s, {...a, dataReady:true}, undefined, "ready", {stage:"ready", completed:5, total:5});
      });
    }
    return () => { timers.forEach(clearTimeout); emit = () => {}; };
  }
  if(scenario==="restoring-session"||scenario==="waiting-session"){
    fn(emptyState(),null,scenario==="waiting-session"?"تعذر الاتصال التجريبي":undefined,scenario==="waiting-session"?"waiting":"restoring");
    return ()=>{emit=()=>{};};
  }
  fn(s, a);
  return () => {
    emit = () => {};
  };
}
export async function execute(c: any) {
  s = applyCommand(
    s,
    a,
    { ...c, requestId: c.requestId || crypto.randomUUID() },
    ["inventory-plan","follow-up"].includes(new URLSearchParams(location.search).get("scenario") || "")
      ? new Date().toISOString() : "2026-10-16T12:00:00Z",
  );
  emit(s, a);
  if (
    new URLSearchParams(location.search).get("scenario") ===
      "ambiguous-receipt" &&
    c.action === "income.pay" &&
    !lostReceiptAcknowledgement
  ) {
    lostReceiptAcknowledgement = true;
    throw new Error("انقطع تأكيد الشبكة التجريبي بعد حفظ السند");
  }
}
export async function login() {
  emit(s, a);
}
export async function logout() {
  emit(emptyState(), null);
}
export async function member() {
  throw new Error("الفحص محلي ولا يرسل دعوات");
}
export const errorText = (e: unknown) =>
  e instanceof Error ? e.message : String(e);
