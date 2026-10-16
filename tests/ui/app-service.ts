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
let emit: (s: State, a: Actor | null, error?: string) => void = () => {};
export const inspectQA = () => structuredClone(s);
(window as any).__alatheelQA = inspectQA;
export function connect(fn: typeof emit) {
  emit = fn;
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
