import { initializeApp } from "firebase/app";
import {
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
  onSnapshotsInSync,
  query,
  where,
} from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";
import { Capacitor } from "@capacitor/core";
import { App as NativeApp } from "@capacitor/app";
import { FirebaseAuthentication } from "@capacitor-firebase/authentication";
import { assertSession,sessionExpiresAt } from "../functions/src/session-policy";
import { createPersistentAuth } from "./persistent-auth";
import { authFailureAction, type AuthPhase } from "./auth-recovery";
import { createStartupDataGate, requiresStartupMaintenance, type StartupDataProgress } from "./startup-data";
import { businessDay } from "../functions/src/dates";
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
const persistentAuth = app ? createPersistentAuth(app) : null;
const auth = persistentAuth?.auth || null,
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
  actor: Actor | null = null;
let authError: string | undefined;
let authPhase: AuthPhase = "restoring";
let retryAuthentication = () => {};
let startupProgress: StartupDataProgress = { stage: "session", completed: 0, total: 1 };
let emit: (s: State, a: Actor | null, error?: string, phase?: AuthPhase, progress?: StartupDataProgress) => void = () => {};
let subscriptions: (() => void)[] = [];
const publish = (error?: string) =>
  emit(
    actor
      ? visibleState(state, actor)
      : { ...emptyState(), settings: state.settings },
    actor,
    error,
    authPhase,
    startupProgress,
  );
const stop = () => {
  subscriptions.forEach((fn) => fn());
  subscriptions = [];
};
export function connect(callback: typeof emit) {
  emit = callback;
  if (!auth || !db || !functions) {
    authPhase = "signed-out";
    publish("خدمة تسجيل الدخول غير مهيأة. لا يمكن الدخول حتى اكتمال ربط Google.");
    return () => {};
  }
  let disposed = false, generation = 0, expiresAt = 0, retryCount = 0;
  let dataGate: ReturnType<typeof createStartupDataGate> | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let sessionTimer: ReturnType<typeof setTimeout> | undefined;
  const publicUnsub = onSnapshot(doc(db, "settings", "main"), snap => {
    if (disposed) return;
    state.settings = snap.exists() ? [{ ...snap.data(), id: "main" }] : [];
    publish(authError);
  });
  const authenticate = async (current: User | null) => {
    const attempt = ++generation;
    let failedAttempt = false;
    const superseded = () => disposed || attempt !== generation || auth?.currentUser?.uid !== current?.uid;
    const stale = () => failedAttempt || superseded();
    expiresAt = 0;
    clearTimeout(retryTimer); clearTimeout(sessionTimer);
    stop(); dataGate = undefined;
    actor = null;
    state = emptyState();
    startupProgress = { stage: "session", completed: 0, total: 1 };
    authPhase = current ? "restoring" : "signed-out";
    publish(authError);
    if (!current) return;
    const failAuthentication = async (error: unknown) => {
      if (stale()) return;
      failedAttempt = true;
      authError = errorText(error);
      stop(); dataGate = undefined;
      actor = null;
      state = emptyState();
      const action = authFailureAction(error);
      if (action !== "sign-out") {
        authPhase = action === "block" ? "blocked" : "waiting";
        publish(authError);
        if (action === "retry") {
          const delay = Math.min(30000, 5000 * 2 ** Math.min(retryCount++, 3));
          retryTimer = setTimeout(async () => {
            if (superseded()) return;
            try { await current.getIdToken(true); }
            catch (refreshError) {
              if (superseded()) return;
              if (authFailureAction(refreshError) === "sign-out") { await logout(false); return; }
            }
            if (!superseded()) void authenticate(current);
          }, delay);
        }
        return;
      }
      authPhase = "signed-out";
      publish(authError);
      if (Capacitor.isNativePlatform()) await FirebaseAuthentication.signOut().catch(() => {});
      if (!superseded()) await signOut(auth!).catch(() => {});
    };
    try {
      await persistentAuth!.ready;
      if (stale()) return;
      const token = await current.getIdTokenResult();
      if (stale()) return;
      try { assertSession(token.claims.auth_time); }
      catch (e) { throw Object.assign(e instanceof Error ? e : new Error("انتهت الجلسة"), { code: "auth/session-expired" }); }
      expiresAt = sessionExpiresAt(token.claims.auth_time);
      sessionTimer = setTimeout(() => { if (!superseded()) expireSession(); }, Math.max(0, expiresAt - Date.now()));
      startupProgress = { stage: "access", completed: 0, total: 1 };
      publish(authError);
      // A fresh server validation is required on launch; cache never grants access.
      await httpsCallable(functions!, "ensureProfile")({});
      if (stale()) return;
      // A cached profile never approves access, but must not leave the opening
      // screen waiting forever when the listener cannot reach the server.
      const profileTimer = setTimeout(() => {
        if (!stale()) void failAuthentication(Object.assign(
          new Error("تعذر التحقق من صلاحيات الحساب. تحقق من اتصالك ثم أعد المحاولة"),
          { code: "startup/profile-timeout" },
        ));
      }, 15000);
      subscriptions.push(() => clearTimeout(profileTimer));
      const pUnsub = onSnapshot(doc(db!, "users", current.uid), { includeMetadataChanges: true }, snap => {
        if (stale()) return;
        const authoritative = !snap.metadata.fromCache && !snap.metadata.hasPendingWrites;
        if (!authoritative) {
          if (actor) actor.dataReady = false;
          dataGate?.snapshot("profile", false);
          return;
        }
        clearTimeout(profileTimer);
        const profile = snap.data();
        if (!profile || profile.disabled || profile.deleted || profile.membershipApproved !== true) {
          void failAuthentication(Object.assign(new Error("الحساب معطل أو غير متاح"), { code: "functions/permission-denied" }));
          return;
        }
        if (actor && (actor.role !== profile.role || actor.ownerRecordId !== profile.ownerRecordId)) {
          // Re-check a changed role without discarding the valid seven-day session.
          void authenticate(current);
          return;
        }
        if (actor) {
          actor.displayName = profile.displayName;
          if (!staff(actor)) state.users = [normalizeRecord("users", current.uid, profile)];
          dataGate?.snapshot("profile", true);
          return;
        }
        const a: Actor = {
          uid: current.uid, displayName: profile.displayName, role: profile.role,
          disabled: profile.disabled, ownerRecordId: profile.ownerRecordId,
          photoURL: current.photoURL || "", dataReady: false,
        };
        actor = a;
        authPhase = "ready";
        authError = undefined;
        retryCount = 0;
        if (!staff(a)) state.users = [normalizeRecord("users", current.uid, profile)];
        const watched = collections.filter(c => staff(a) || ![
          "users", "owners", "mealTypes", "inventoryTransactions", "expenses",
          "expensePayments", "financialReports", "financialPeriods",
        ].includes(c));
        let maintenanceRequestId: string | undefined;
        dataGate = createStartupDataGate({
          collections: ["profile", ...watched],
          active: () => !stale() && actor === a,
          needsMaintenance: () => staff(a) && requiresStartupMaintenance(state, businessDay(new Date().toISOString())),
          maintain: () => {
            maintenanceRequestId ||= crypto.randomUUID();
            return httpsCallable(functions!, "operate")({ action: "finance.rollover", requestId: maintenanceRequestId });
          },
          progress: progress => {
            if (stale() || actor !== a) return;
            startupProgress = progress;
            a.dataReady = progress.stage === "ready";
            if (a.dataReady) {
              authError = undefined; retryCount = 0; maintenanceRequestId = undefined;
              clearTimeout(retryTimer);
            }
            publish(authError);
          },
          failed: error => {
            if (stale() || actor !== a) return;
            if (authFailureAction(error) !== "retry") { void failAuthentication(error); return; }
            // Catch-up failure is not an authentication failure. Keep the verified
            // identity while blocking balances and mutations until data is current.
            authError = errorText(error); a.dataReady = false;
            publish(authError);
            clearTimeout(retryTimer);
            // A clock mismatch or missing listener confirmation needs an explicit
            // retry; repeatedly writing the same financial request cannot fix it.
            if ((error as { code?: string }).code === "startup/snapshot-timeout") return;
            retryTimer = setTimeout(() => {
              if (!stale() && actor === a) dataGate?.retry();
            }, Math.min(30000, 5000 * 2 ** Math.min(retryCount++, 3)));
          },
        });
        const gate = dataGate;
        subscriptions.push(() => gate.dispose());
        gate.snapshot("profile", true);
        for (const c of watched) {
          const ref = collection(db!, storageCollection(c));
          const q = ["horses", "registrationRequests", "income", "activities"].includes(c) && !staff(a)
            ? query(ref, where("ownerId", "==", a.ownerRecordId || a.uid)) : ref;
          subscriptions.push(onSnapshot(q, { includeMetadataChanges: true }, snapshot => {
            if (stale() || actor !== a) return;
            // Never publish a partly delivered transaction through another listener.
            a.dataReady = false;
            state[c] = snapshot.docs.map(d => normalizeRecord(c, d.id, d.data()));
            gate.snapshot(c, !snapshot.metadata.fromCache && !snapshot.metadata.hasPendingWrites);
          }, error => { if (!stale() && actor === a) void failAuthentication(error); }));
        }
        subscriptions.push(onSnapshotsInSync(db!, () => {
          if (!stale() && actor === a) gate.synchronize();
        }));
        startupProgress = { stage: "data", completed: 1, total: watched.length + 1 };
        publish();
      }, error => { if (!stale()) void failAuthentication(error); });
      subscriptions.push(pUnsub);
    } catch (error) { await failAuthentication(error); }
  };
  function expireSession() {
    generation++; expiresAt = 0; clearTimeout(retryTimer); clearTimeout(sessionTimer);
    authError = "انتهت مدة الدخول البالغة 7 أيام؛ سجل الدخول عبر Google مجددًا";
    actor = null; authPhase = "signed-out"; stop(); publish(authError); void logout(false);
  }
  function checkSession() { if (!disposed && expiresAt && Date.now() >= expiresAt) expireSession(); }
  const resume = () => {
    checkSession();
    if (authPhase === "waiting") retryAuthentication();
    else if (actor && authPhase === "ready") dataGate?.synchronize();
  };
  const visibility = () => { if (document.visibilityState === "visible") resume(); };
  document.addEventListener("visibilitychange", visibility);
  let removeResume: undefined | (() => void);
  if (Capacitor.isNativePlatform()) void NativeApp.addListener("appStateChange", ({ isActive }) => {
    if (isActive) resume();
  }).then(h => { if (disposed) void h.remove(); else removeResume = () => void h.remove(); });
  const unsub = onAuthStateChanged(auth, authenticate);
  retryAuthentication = () => {
    if (disposed || !auth?.currentUser) return;
    checkSession();
    if (actor && authPhase === "ready" && dataGate) dataGate.retry();
    else if (authPhase !== "signed-out") void authenticate(auth.currentUser);
  };
  const online = () => {
    if (authPhase === "waiting" || actor && !actor.dataReady) retryAuthentication();
  };
  window.addEventListener("online", online);
  return () => {
    disposed = true; clearTimeout(retryTimer); clearTimeout(sessionTimer);
    document.removeEventListener("visibilitychange", visibility); removeResume?.();
    window.removeEventListener("online", online); retryAuthentication = () => {};
    stop(); dataGate = undefined; unsub(); publicUnsub();
  };
}

export function errorText(e: unknown) {
  return e instanceof Error
    ? e.message.replace(/^Firebase:\s*/, "")
    : "تعذر تنفيذ العملية، أعد المحاولة";
}
export async function login() {
  authError = undefined;
  ensure(auth, "خدمة Google غير مهيأة بعد. تواصل مع مدير الإسطبل");
  await persistentAuth!.ready;
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
export function retryLoginSession(){retryAuthentication();}
export async function logout(clearError=true) {
  if(clearError)authError = undefined;
  if(androidPush){await StaffPush.disable().catch(()=>{});if(functions&&auth?.currentUser)await httpsCallable(functions,"updatePushDevice")({action:"remove",deviceId:pushDeviceId()}).catch(()=>{});}
  if (Capacitor.isNativePlatform()) await FirebaseAuthentication.signOut();
  if (auth) await signOut(auth);
}
export function getNotificationServices(){return db&&functions?{db,functions}:null;}
export async function feedbackCommand(data: Record<string, any>) {
  ensure(actor?.role === "admin" && authPhase === "ready" && actor.dataReady, "ملاحظات التطبيق للمدير بعد اكتمال الدخول");
  ensure(functions, "الاتصال غير جاهز");
  return (await httpsCallable(functions, "appFeedback", { timeout: 120000 })(data)).data as any;
}
const pendingCommands = new Map<string, string>();
export async function execute(
  c: Omit<Command, "requestId"> & { requestId?: string },
) {
  ensure(actor, "سجل الدخول أولًا");
  ensure(authPhase === "ready" && actor.dataReady, "انتظر اكتمال تحديث بيانات الحساب قبل تنفيذ العملية");
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
  ensure(authPhase === "ready" && actor.dataReady, "انتظر اكتمال تحديث بيانات الحساب قبل تنفيذ العملية");
  ensure(functions, "الاتصال غير جاهز");
  await httpsCallable(functions, "manageMember")({ action, id, data });
}
