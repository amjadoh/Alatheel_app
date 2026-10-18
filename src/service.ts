import { initializeApp } from "firebase/app";
import {
  getAuth,
  onAuthStateChanged,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithCredential,
  signOut,
  User,
  setPersistence,
  browserLocalPersistence,
} from "firebase/auth";
import {
  getFirestore,
  getDoc,
  collection,
  doc,
  onSnapshot,
  query,
  where,
} from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";
import { Capacitor } from "@capacitor/core";
import { App as NativeApp } from "@capacitor/app";
import { FirebaseAuthentication } from "@capacitor-firebase/authentication";
import { assertSession,sessionExpiresAt } from "../functions/src/session-policy";
import { androidPush,StaffPush,pushDeviceId } from "./native-push";
import project from "./firebase-project.json";
import { storageCollection, normalizeRecord } from "../functions/src/records";
import {
  Actor,
  State,
  Command,
  collections,
  emptyState,
  visibleState,
  ensure,
  staff,
} from "../functions/src/domain";
export { staff, bill, money, nextMonth } from "../functions/src/domain";
export type { Actor, State, Row, Command, Role } from "../functions/src/domain";
const configured =
  !!(import.meta.env.VITE_FIREBASE_PROJECT_ID || project.projectId) &&
  !!(import.meta.env.VITE_FIREBASE_API_KEY || project.apiKey);
const app = configured
  ? initializeApp({
      apiKey: import.meta.env.VITE_FIREBASE_API_KEY || project.apiKey,
      authDomain:
        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || project.authDomain,
      projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || project.projectId,
      appId: import.meta.env.VITE_FIREBASE_APP_ID || project.appId,
    })
  : null;
const auth = app ? getAuth(app) : null,
  db = app
    ? getFirestore(
        app,
        import.meta.env.VITE_FIREBASE_DATABASE_ID || project.databaseId,
      )
    : null,
  functions = app
    ? getFunctions(
        app,
        import.meta.env.VITE_FIREBASE_FUNCTIONS_REGION || "us-central1",
      )
    : null;
let state: State = emptyState(),
  actor: Actor | null = null,
  user: User | null = null;
let authError: string | undefined;
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
export function connect(callback: typeof emit) {
  emit = callback;
  if (!auth || !db || !functions) {
    publish(
      "خدمة تسجيل الدخول غير مهيأة. لا يمكن الدخول حتى اكتمال ربط Google.",
    );
    return () => {};
  }
  const publicUnsub = onSnapshot(doc(db, "settings", "main"), (snap) => {
    state.settings = snap.exists() ? [{ ...snap.data(), id: "main" }] : [];
    publish();
  });
  let disposed=false,persistenceConfigured=false,generation=0,expiresAt=0;
  let retryTimer:ReturnType<typeof setTimeout>|undefined,sessionTimer:ReturnType<typeof setTimeout>|undefined;
  const authenticate = async (current:User|null) => {
    const attempt=++generation;
    const stale=()=>disposed||attempt!==generation||auth?.currentUser?.uid!==current?.uid;
    expiresAt=0;
    clearTimeout(retryTimer);clearTimeout(sessionTimer);
    stop();
    user = current;
    actor = null;
    state = emptyState();
    publish(authError);
    if (!current) return;
    try {
      if(!persistenceConfigured){await setPersistence(auth!,browserLocalPersistence);persistenceConfigured=true;}
      const token=await current.getIdTokenResult();
      if(stale())return;
      try{assertSession(token.claims.auth_time);}catch(e){throw Object.assign(e instanceof Error?e:new Error("انتهت الجلسة"),{code:"functions/unauthenticated"});}
      expiresAt=sessionExpiresAt(token.claims.auth_time);
      sessionTimer=setTimeout(()=>{if(!stale())expireSession();},Math.max(0,expiresAt-Date.now()));
      await httpsCallable(functions!, "ensureProfile")({});
      // Owners have no access to financial bases; staff rollover is server-authorized.
      // Try after profile read below, before subscribing to the financial data.
      const initialProfile = await getDoc(doc(db!, "users", current.uid));
      if(stale())return;
      if (["admin", "employee"].includes(initialProfile.data()?.role)) {
        await httpsCallable(
          functions!,
          "operate",
        )({ action: "finance.rollover", requestId: crypto.randomUUID() });
      }
      if(stale())return;
      const pUnsub = onSnapshot(doc(db!, "users", current.uid), (snap) => {
        if(stale())return;
        const p = snap.data();
        if (!p || p.disabled) {
          stop();
          actor = null;
          publish("الحساب معطل أو غير متاح");
          void signOut(auth!);
          return;
        }
        const changed =
          actor?.role !== p.role || actor?.ownerRecordId !== p.ownerRecordId;
        actor = {
          uid: current.uid,
          displayName: p.displayName,
          role: p.role,
          disabled: p.disabled,
          ownerRecordId: p.ownerRecordId,
          photoURL: current.photoURL || "",
        };
        if (changed) {
          stop();
          state = emptyState();
          if (!staff(actor))
            state.users = [normalizeRecord("users", current.uid, p)];
          subscribeData();
          subscriptions.push(
            onSnapshot(doc(db!, "users", current.uid), (profile) => {
              if(stale())return;
              const u = profile.data();
              if (
                u?.disabled ||
                u?.role !== actor?.role ||
                u?.ownerRecordId !== actor?.ownerRecordId
              ) {
                void signOut(auth!);
              } else if (u && actor) {
                actor.displayName = u.displayName;
                if (!staff(actor))
                  state.users = [normalizeRecord("users", current.uid, u)];
                publish();
              }
            }),
          );
        }
        publish();
      });
      subscriptions.push(pUnsub);
    } catch (e) {
      if(stale())return;
      authError = errorText(e);
      stop();
      const code=(e as {code?:string}).code;
      const accessFailure=["functions/permission-denied","functions/unauthenticated","auth/user-disabled","auth/user-token-expired","auth/id-token-revoked","permission-denied"].includes(code||"");
      if(!accessFailure){publish(authError);retryTimer=setTimeout(()=>{if(!disposed&&auth?.currentUser?.uid===current.uid)void authenticate(current);},5000);return;}
      actor = null;
      state = emptyState();
      if (Capacitor.isNativePlatform())
        await FirebaseAuthentication.signOut().catch(() => {});
      await signOut(auth!).catch(() => {});
      publish(authError);
    }
  };
  function expireSession(){authError="انتهت مدة الدخول البالغة 7 أيام؛ سجل الدخول عبر Google مجددًا";actor=null;stop();publish(authError);void logout(false);}
  function checkSession(){if(!disposed&&expiresAt&&Date.now()>=expiresAt)expireSession();}
  const visibility=()=>{if(document.visibilityState==="visible")checkSession();};
  document.addEventListener("visibilitychange",visibility);
  let removeResume:undefined|(()=>void);
  if(Capacitor.isNativePlatform())void NativeApp.addListener("appStateChange",({isActive})=>{if(isActive)checkSession();}).then(h=>{if(disposed)void h.remove();else removeResume=()=>void h.remove();});
  const unsub = onAuthStateChanged(auth, authenticate);
  return () => {
    disposed=true;clearTimeout(retryTimer);clearTimeout(sessionTimer);
    document.removeEventListener("visibilitychange",visibility);removeResume?.();
    stop();
    unsub();
    publicUnsub();
  };
}
function subscribeData() {
  if (!db || !actor) return;
  const a = actor;
  a.dataReady = false;
  const received = new Set<string>();
  const watched = collections.filter(
    (c) =>
      staff(a) ||
      ![
        "users",
        "owners",
        "mealTypes",
        "inventoryTransactions",
        "expenses",
        "expensePayments",
        "financialReports",
        "financialPeriods",
      ].includes(c),
  );
  for (const c of collections) {
    if (c === "users" && !staff(a)) continue; // Own profile is already watched by document ID.
    if (
      !["admin", "employee"].includes(a.role) &&
      [
        "owners",
        "mealTypes",
        "inventoryTransactions",
        "expenses",
        "expensePayments",
        "financialReports",
        "financialPeriods",
      ].includes(c)
    )
      continue;
    const ref = collection(db, storageCollection(c));
    const q =
      c === "users" && !["admin", "employee"].includes(a.role)
        ? query(ref, where("uid", "==", a.uid))
        : ["horses", "registrationRequests", "income", "activities"].includes(
              c,
            ) && !["admin", "employee"].includes(a.role)
          ? query(ref, where("ownerId", "==", a.ownerRecordId || a.uid))
          : ref;
    subscriptions.push(
      onSnapshot(
        q,
        (snap) => {
          state[c] = snap.docs.map((d) => normalizeRecord(c, d.id, d.data()));
          received.add(c);
          a.dataReady = watched.every((name) => received.has(name));
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
export async function login() {
  authError = undefined;
  ensure(auth, "خدمة Google غير مهيأة بعد. تواصل مع مدير الإسطبل");
  if (Capacitor.isNativePlatform()) {
    const result = await FirebaseAuthentication.signInWithGoogle();
    ensure(result.credential?.idToken, "لم يكتمل تسجيل الدخول");
    await signInWithCredential(
      auth,
      GoogleAuthProvider.credential(result.credential.idToken),
    );
  } else {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    await signInWithPopup(auth, provider);
  }
}
export async function logout(clearError=true) {
  if(clearError)authError = undefined;
  if(androidPush){await StaffPush.disable().catch(()=>{});if(functions&&auth?.currentUser)await httpsCallable(functions,"updatePushDevice")({action:"remove",deviceId:pushDeviceId()}).catch(()=>{});}
  if (Capacitor.isNativePlatform()) await FirebaseAuthentication.signOut();
  if (auth) await signOut(auth);
}
export function getNotificationServices(){return db&&functions?{db,functions}:null;}
const pendingCommands = new Map<string, string>();
export async function execute(
  c: Omit<Command, "requestId"> & { requestId?: string },
) {
  ensure(actor, "سجل الدخول أولًا");
  const retryKey = JSON.stringify([actor.uid, c.action, c.id, c.data]);
  const command = {
    ...c,
    requestId:
      c.requestId || pendingCommands.get(retryKey) || crypto.randomUUID(),
  };
  ensure(functions, "الاتصال غير جاهز");
  pendingCommands.set(retryKey, command.requestId);
  try {
    await httpsCallable(functions, "operate")(command);
    pendingCommands.delete(retryKey);
  } catch (error) {
    // Keep the receipt ID after an ambiguous network failure so a retry is safe.
    const code = (error as { code?: string }).code;
    if (
      code &&
      ![
        "functions/unavailable",
        "functions/deadline-exceeded",
        "functions/internal",
        "functions/unknown",
      ].includes(code)
    )
      pendingCommands.delete(retryKey);
    throw error;
  }
}
export async function member(
  action: string,
  id?: string,
  data: Record<string, any> = {},
) {
  ensure(actor?.role === "admin", "إدارة الأعضاء للمدير فقط");
  ensure(functions, "الاتصال غير جاهز");
  await httpsCallable(functions, "manageMember")({ action, id, data });
}
