import { initializeApp } from "firebase/app";
import {
  getAuth,
  onAuthStateChanged,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithCredential,
  signOut,
  User,
} from "firebase/auth";
import {
  getFirestore,
  collection,
  doc,
  onSnapshot,
  query,
  where,
} from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";
import { Capacitor } from "@capacitor/core";
import { FirebaseAuthentication } from "@capacitor-firebase/authentication";
import {
  Actor,
  State,
  Command,
  collections,
  emptyState,
  applyCommand,
  visibleState,
  ensure,
  nextMonth,
} from "../functions/src/domain";
export { staff, bill, money, nextMonth } from "../functions/src/domain";
export type { Actor, State, Row, Command, Role } from "../functions/src/domain";
export const demo = import.meta.env.VITE_DEMO_MODE === "true";
const configured =
  !!import.meta.env.VITE_FIREBASE_PROJECT_ID &&
  !!import.meta.env.VITE_FIREBASE_API_KEY;
const app =
  !demo && configured
    ? initializeApp({
        apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
        authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
        projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
        appId: import.meta.env.VITE_FIREBASE_APP_ID,
      })
    : null;
const auth = app ? getAuth(app) : null,
  db = app
    ? getFirestore(
        app,
        import.meta.env.VITE_FIREBASE_DATABASE_ID || "(default)",
      )
    : null,
  functions = app
    ? getFunctions(
        app,
        import.meta.env.VITE_FIREBASE_FUNCTIONS_REGION || "us-central1",
      )
    : null;
const today = new Date().toISOString().slice(0, 10);
function seed(): State {
  const s = emptyState();
  s.users = [
    ["admin", "مدير الإسطبل", "admin"],
    ["employee", "موظف التشغيل", "employee"],
    ["owner", "مالك تجريبي", "owner"],
    ["viewer", "عضو جديد", "viewer"],
  ].map(([id, displayName, role]) => ({
    id,
    uid: id,
    displayName,
    role,
    email: id + "@example.com",
    phoneNumber: "0500000000",
    disabled: false,
  }));
  s.horses = [
    {
      id: "h1",
      name: "أصيل",
      ownerId: "owner",
      ownerName: "مالك تجريبي",
      status: "boarding",
      boardingFee: 2500,
      entryDate: today,
      dueDate: today,
      registrationNum: "ATH-101",
      feeding: [{ mealTypeId: "m1", quantity: 5 }],
      notes: "بيانات للتجربة",
    },
    {
      id: "h2",
      name: "عنود",
      ownerId: "owner",
      ownerName: "مالك تجريبي",
      status: "boarding_breeding",
      boardingFee: 3000,
      entryDate: today,
      dueDate: nextMonth(today),
      feeding: [],
    },
  ];
  s.mealTypes = [
    {
      id: "m1",
      name: "شعير",
      unit: "كجم",
      currentStock: 320,
      minThreshold: 100,
      pricePerUnit: 3,
    },
    {
      id: "m2",
      name: "برسيم",
      unit: "ربطة",
      currentStock: 8,
      minThreshold: 12,
      pricePerUnit: 25,
    },
  ];
  s.expenses = [
    {
      id: "e1",
      name: "زيارة بيطرية مشتركة",
      cost: 400,
      frequency: "once",
      horseIds: ["h1", "h2"],
      allocations: { h1: 200, h2: 200 },
      collectedHorseIds: [],
      createdAt: new Date().toISOString(),
    },
  ];
  s.settings = [
    { id: "main", stableName: "إسطبل الأثيل", phone: "", address: "" },
  ];
  return s;
}
let state: State = seed(),
  actor: Actor | null = null,
  user: User | null = null;
if (demo) {
  try {
    const saved = localStorage.getItem("alatheel-demo-v1");
    if (saved) state = JSON.parse(saved);
  } catch {
    state = seed();
  }
}
let emit: (s: State, a: Actor | null, error?: string) => void = () => {};
let subscriptions: (() => void)[] = [];
const publish = (error?: string) =>
  emit(
    actor
      ? visibleState(state, actor)
      : { ...emptyState(), settings: state.settings },
    actor,
    error,
  );
const stop = () => {
  subscriptions.forEach((fn) => fn());
  subscriptions = [];
};
const persist = () => {
  if (demo) localStorage.setItem("alatheel-demo-v1", JSON.stringify(state));
  publish();
};
export function connect(callback: typeof emit) {
  emit = callback;
  if (demo) {
    publish();
    return () => {};
  }
  if (!auth || !db || !functions) {
    publish(
      "يلزم إدخال إعدادات Firebase أو تشغيل وضع التجربة من ملف الإعدادات.",
    );
    return () => {};
  }
  const publicUnsub = onSnapshot(doc(db, "settings", "main"), (snap) => {
    state.settings = snap.exists() ? [{ ...snap.data(), id: "main" }] : [];
    publish();
  });
  const unsub = onAuthStateChanged(auth, async (current) => {
    stop();
    user = current;
    actor = null;
    state = emptyState();
    publish();
    if (!current) return;
    try {
      await httpsCallable(functions!, "ensureProfile")({});
      const pUnsub = onSnapshot(doc(db!, "users", current.uid), (snap) => {
        const p = snap.data();
        if (!p || p.disabled) {
          stop();
          actor = null;
          publish("الحساب معطل أو غير متاح");
          void signOut(auth!);
          return;
        }
        const changed = actor?.role !== p.role;
        actor = {
          uid: current.uid,
          displayName: p.displayName,
          role: p.role,
          disabled: p.disabled,
        };
        if (changed) {
          stop();
          state = emptyState();
          subscribeData();
          subscriptions.push(
            onSnapshot(doc(db!, "users", current.uid), (profile) => {
              const u = profile.data();
              if (u?.disabled || u?.role !== actor?.role) {
                void signOut(auth!);
              } else if (u && actor) {
                actor.displayName = u.displayName;
                publish();
              }
            }),
          );
        }
        publish();
      });
      subscriptions.push(pUnsub);
    } catch (e) {
      publish(errorText(e));
    }
  });
  return () => {
    stop();
    unsub();
    publicUnsub();
  };
}
function subscribeData() {
  if (!db || !actor) return;
  const a = actor;
  for (const c of collections) {
    if (
      !["admin", "employee"].includes(a.role) &&
      ["mealTypes", "inventoryTransactions", "expenses"].includes(c)
    )
      continue;
    const ref = collection(db, c);
    const q =
      c === "users" && !["admin", "employee"].includes(a.role)
        ? query(ref, where("uid", "==", a.uid))
        : ["horses", "registrationRequests", "income", "activities"].includes(
              c,
            ) && !["admin", "employee"].includes(a.role)
          ? query(ref, where("ownerId", "==", a.uid))
          : ref;
    subscriptions.push(
      onSnapshot(
        q,
        (snap) => {
          state[c] = snap.docs.map((d) => ({ ...d.data(), id: d.id }));
          publish();
        },
        (e) => publish(errorText(e)),
      ),
    );
  }
}
export function errorText(e: unknown) {
  return e instanceof Error
    ? e.message.replace(/^Firebase:\s*/, "")
    : "تعذر تنفيذ العملية، أعد المحاولة";
}
export async function login(role = "viewer") {
  if (demo) {
    const u = state.users.find((u) => u.id === role && !u.disabled);
    ensure(u, "الحساب التجريبي غير متاح");
    actor = { uid: u.id, role: u.role, displayName: u.displayName };
    publish();
    return;
  }
  ensure(auth, "أدخل إعدادات الاتصال أولًا");
  if (Capacitor.isNativePlatform()) {
    const result = await FirebaseAuthentication.signInWithGoogle();
    ensure(result.credential?.idToken, "لم يكتمل تسجيل الدخول");
    await signInWithCredential(
      auth,
      GoogleAuthProvider.credential(result.credential.idToken),
    );
  } else await signInWithPopup(auth, new GoogleAuthProvider());
}
export async function logout() {
  if (demo) {
    actor = null;
    publish();
    return;
  }
  if (Capacitor.isNativePlatform()) await FirebaseAuthentication.signOut();
  if (auth) await signOut(auth);
}
const pendingCommands = new Map<string, string>();
export async function execute(
  c: Omit<Command, "requestId"> & { requestId?: string },
) {
  ensure(actor, "سجل الدخول أولًا");
  const retryKey = JSON.stringify([actor.uid, c.action, c.id, c.data]);
  const command = { ...c, requestId: c.requestId || pendingCommands.get(retryKey) || crypto.randomUUID() };
  if (demo) {
    state = applyCommand(state, actor, command);
    persist();
    return;
  }
  ensure(functions, "الاتصال غير جاهز");
  pendingCommands.set(retryKey, command.requestId);
  try {
    await httpsCallable(functions, "operate")(command);
    pendingCommands.delete(retryKey);
  } catch (error) {
    // Keep the receipt ID after an ambiguous network failure so a retry is safe.
    const code = (error as {code?: string}).code;
    if (code && !['functions/unavailable', 'functions/deadline-exceeded', 'functions/internal', 'functions/unknown'].includes(code)) pendingCommands.delete(retryKey);
    throw error;
  }
}
export async function member(
  action: string,
  id?: string,
  data: Record<string, any> = {},
) {
  ensure(actor?.role === "admin", "إدارة الأعضاء للمدير فقط");
  if (!demo) {
    ensure(functions, "الاتصال غير جاهز");
    await httpsCallable(functions, "manageMember")({ action, id, data });
    return;
  }
  if (action === "create") {
    ensure(
      !state.users.some((u) => u.email === data.email),
      "البريد مسجل مسبقًا",
    );
    const uid = crypto.randomUUID();
    state.users.push({ ...data, id: uid, uid, disabled: false });
  } else {
    ensure(id !== actor.uid, "لا يمكنك تغيير حسابك من هذه الشاشة");
    const u = state.users.find((u) => u.id === id);
    ensure(u, "العضو غير موجود");
    if (action === "delete") {
      ensure(
        !state.horses.some((h) => h.ownerId === id && h.status !== "archived"),
        "العضو مرتبط بخيل نشط",
      );
      u.deleted = true;
      u.disabled = true;
    } else if (action === "update") Object.assign(u, data);
    else u.disabled = action === "disable";
  }
  persist();
}
export function resetDemo() {
  if (demo) {
    state = seed();
    actor = null;
    persist();
  }
}
