// Used exclusively by vite.qa.config.ts, never by the production build.
import {
  emptyState,
  applyCommand,
  type State,
  type Actor,
} from "../../functions/src/domain";
export { staff, bill, money, nextMonth } from "../../functions/src/domain";
export type {
  Actor,
  State,
  Row,
  Command,
  Role,
} from "../../functions/src/domain";
let s = emptyState();
export function getNotificationServices(){return null as any;}
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
let emit: (s: State, a: Actor | null, error?: string, phase?: import("../../src/auth-recovery").AuthPhase) => void = () => {};
export function retryLoginSession() { emit(s,a,undefined,"ready"); }
if(new URLSearchParams(location.search).get("scenario")==="owner-alerts"){
  a.uid="owner";a.ownerRecordId="owner";a.role="owner";a.displayName="مالك تجريبي";
}
let lostReceiptAcknowledgement = false;
export const inspectQA = () => structuredClone(s);
(window as any).__alatheelQA = inspectQA;
export function connect(fn: typeof emit) {
  emit = fn;
  const scenario=new URLSearchParams(location.search).get("scenario");
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
    "2026-10-16T12:00:00Z",
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
