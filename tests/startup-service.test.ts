import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as domain from "../functions/src/domain";
import * as records from "../functions/src/records";
import * as session from "../functions/src/session-policy";
import * as dates from "../functions/src/dates";
import * as recovery from "../src/auth-recovery";
import * as preparation from "../src/startup-data";
import * as releaseNotes from '../src/release-notes';

// Execute the actual service orchestration with isolated Firebase boundaries.
// Domain, normalization, session policy and readiness gate remain the real modules.
// No Firebase SDK/network, durable user storage, or production data is touched.
const source = readFileSync(new URL("../src/service.ts", import.meta.url), "utf8")
  .replaceAll("import.meta.env", "({})");
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText;
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
const admin = { uid: "test-admin", role: "admin" as const, displayName: "مدير الاختبار" };
const profile = { ...admin, membershipApproved: true, disabled: false };
function fixture() {
  return domain.applyCommand(domain.emptyState(), admin,
    { action: "finance.rollover", requestId: "isolated_fixture" }, new Date().toISOString());
}
function deferred() {
  let resolve!: () => void, reject!: (error: unknown) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
type Subscription = { path: string; next: (snapshot: any) => void; error?: (error: any) => void; active: boolean };
function harness(authTime = Math.floor(Date.now() / 1000) - 3600) {
  const subscriptions: Subscription[] = [], sync: { next: () => void; active: boolean }[] = [];
  const calls: { name: string; data: any }[] = [], outputs: any[] = [];
  const timers = new Map<number, () => void>(); let nextTimer = 1, signOuts = 0;
  let snapshotWait: (() => void) | undefined;
  let authChanged!: (user: any) => Promise<void>;
  let operate: (data: any) => Promise<any> = async () => ({ data: { ok: true } });
  const user = { uid: admin.uid, photoURL: "", getIdTokenResult: async () => ({ claims: { auth_time: authTime } }), getIdToken: async () => "isolated-token" };
  const auth = { currentUser: user as any };
  const deps: Record<string, any> = {
    './release-notes': releaseNotes,
    "firebase/app": { initializeApp: () => ({}) },
    "firebase/auth": {
      onAuthStateChanged: (_: any, next: any) => { authChanged = next; return () => {}; },
      signOut: async () => { signOuts++; auth.currentUser = null; },
    },
    "firebase/firestore": {
      getFirestore: () => ({}), doc: (_: any, ...path: string[]) => ({ path: path.join("/") }),
      collection: (_: any, path: string) => ({ path }), query: (ref: any) => ref, where: () => ({}),
      onSnapshot: (ref: any, options: any, callback?: any, error?: any) => {
        const next = typeof options === "function" ? options : callback;
        const item = { path: ref.path, next, error, active: true };
        subscriptions.push(item); return () => { item.active = false; };
      },
      onSnapshotsInSync: (_: any, next: () => void) => {
        const item = { next, active: true }; sync.push(item); return () => { item.active = false; };
      },
    },
    "firebase/functions": {
      getFunctions: () => ({}),
      httpsCallable: (_: any, name: string) => (data: any) => {
        calls.push({ name, data });
        return name === "operate" ? operate(data) : Promise.resolve({ data: { ok: true } });
      },
    },
    "@capacitor/core": { Capacitor: { isNativePlatform: () => false } },
    "@capacitor/app": { App: {} },
    "@capacitor-firebase/authentication": { FirebaseAuthentication: {} },
    "./persistent-auth": { createPersistentAuth: () => ({ auth, ready: Promise.resolve() }) },
    "./native-push": { androidPush: false },
    "./firebase-project.json": { projectId: "isolated-test", apiKey: "isolated-key", databaseId: "isolated-db" },
    "../functions/src/session-policy": session, "../functions/src/domain": domain,
    "../functions/src/records": records, "../functions/src/dates": dates,
    "./auth-recovery": recovery, "./startup-data": {
      ...preparation,
      createStartupDataGate: (options: Parameters<typeof preparation.createStartupDataGate>[0]) => preparation.createStartupDataGate({
        ...options, waitForSnapshots: expired => { snapshotWait = expired; return () => { snapshotWait = undefined; }; },
      }),
    },
  };
  const exported: any = {};
  runInNewContext(compiled, {
    exports: exported, require: (name: string) => {
      assert.ok(Object.hasOwn(deps, name), `Unexpected dependency ${name}`); return deps[name];
    },
    console, Error, crypto: { randomUUID },
    setTimeout: (callback: () => void) => { const id = nextTimer++; timers.set(id, callback); return id; },
    clearTimeout: (id: number) => timers.delete(id),
    document: { visibilityState: "visible", addEventListener() {}, removeEventListener() {} },
    window: { addEventListener() {}, removeEventListener() {} },
  }, { filename: "isolated-service.cjs" });
  const dispose = exported.connect((state: any, actor: any, error: any, phase: any, progress: any) => {
    outputs.push(structuredClone({ state, actor, error, phase, progress }));
  });
  const deliverProfile = (value: any = profile, fromCache = false) => {
    for (const item of subscriptions.filter(s => s.active && s.path === `users/${auth.currentUser?.uid}`))
      item.next({ data: () => value, metadata: { fromCache, hasPendingWrites: false } });
  };
  const deliver = (state: domain.State, names: readonly domain.Collection[] = domain.collections, fromCache = false) => {
    for (const name of names) for (const item of subscriptions.filter(s => s.active && s.path === records.storageCollection(name)))
      item.next({ docs: state[name].map(row => ({ id: row.id, data: () => row })), metadata: { fromCache, hasPendingWrites: false } });
  };
  const synchronize = () => { for (const item of sync.filter(s => s.active)) item.next(); };
  return { api: exported, auth, user, calls, outputs, subscriptions, timers, dispose, deliver, deliverProfile, synchronize,
    expireSnapshotWait: () => snapshotWait?.(),
    start: async () => { await authChanged(user); },
    authChanged: (next: any) => authChanged(next),
    setOperate: (next: typeof operate) => { operate = next; },
    signOuts: () => signOuts, latest: () => outputs.at(-1),
  };
}

test("actual service healthy launch performs one access call, zero rollover and no duplicate profile read", async () => {
  const h = harness(); await h.start();
  assert.deepEqual(h.calls.map(c => c.name), ["ensureProfile"]);
  h.deliverProfile(); h.deliver(fixture()); h.synchronize(); await flush();
  assert.equal(h.latest().phase, "ready"); assert.equal(h.latest().actor.dataReady, true);
  assert.equal(h.calls.filter(c => c.name === "operate").length, 0);
  assert.equal(h.subscriptions.filter(s => s.path === `users/${admin.uid}`).length, 1);
  h.dispose();
});

test("actual service rejects operations and member changes until every server collection is ready", async () => {
  const h = harness(); await h.start(); h.deliverProfile();
  const s = fixture(); h.deliver(s, domain.collections.filter(name => name !== "income")); h.synchronize();
  assert.equal(h.latest().actor.dataReady, false);
  await assert.rejects(h.api.execute({ action: "income.pay" }), /انتظر اكتمال/);
  await assert.rejects(h.api.member("create"), /انتظر اكتمال/);
  h.deliver(s, ["income"], true); h.synchronize();
  assert.equal(h.latest().actor.dataReady, false);
  h.deliver(s, ["income"]); h.synchronize();
  assert.equal(h.latest().actor.dataReady, true);
  h.dispose();
});

test("actual service catch-up runs once and keeps balances blocked until committed snapshots arrive", async () => {
  const h = harness(), pending = deferred(); h.setOperate(() => pending.promise);
  await h.start(); h.deliverProfile(); h.deliver(domain.emptyState()); h.synchronize(); await flush();
  assert.equal(h.calls.filter(c => c.name === "operate").length, 1);
  assert.equal(h.calls.find(c=>c.name==='operate')!.data.clientVersionCode,releaseNotes.RELEASE_VERSION_CODE);
  assert.equal(h.latest().progress.stage, "maintenance");
  pending.resolve(); await flush();
  assert.equal(h.latest().actor.dataReady, false);
  h.deliver(fixture()); h.synchronize(); await flush();
  assert.equal(h.latest().actor.dataReady, true);
  assert.equal(h.calls.filter(c => c.name === "operate").length, 1);
  h.dispose();
});

test("actual service catch-up failure retains login and retry keeps the idempotent request", async () => {
  const h = harness(); let count = 0;
  h.setOperate(async () => { if (++count === 1) throw Object.assign(new Error("network"), { code: "functions/unavailable" }); });
  await h.start(); h.deliverProfile(); h.deliver(domain.emptyState()); h.synchronize(); await flush();
  assert.equal(h.latest().phase, "ready"); assert.equal(h.latest().actor.uid, admin.uid);
  assert.equal(h.latest().actor.dataReady, false); assert.equal(h.signOuts(), 0);
  h.api.retryLoginSession(); await flush();
  const calls = h.calls.filter(c => c.name === "operate");
  assert.equal(calls.length, 2); assert.equal(calls[0].data.requestId, calls[1].data.requestId);
  h.deliver(fixture()); h.synchronize(); assert.equal(h.latest().actor.dataReady, true);
  h.dispose();
});

test("actual service never accepts cached profile approval and blocks revoked membership without stale re-entry", async () => {
  const h = harness(); await h.start(); h.deliverProfile(profile, true); h.synchronize();
  assert.equal(h.latest().actor, null);
  h.deliverProfile(); h.deliver(fixture()); h.synchronize();
  const oldProfile = h.subscriptions.find(s => s.path === `users/${admin.uid}`)!;
  h.deliverProfile({ ...profile, disabled: true }); await flush();
  assert.equal(h.latest().phase, "blocked"); assert.equal(h.latest().actor, null);
  oldProfile.next({ data: () => profile, metadata: { fromCache: false, hasPendingWrites: false } });
  h.synchronize(); assert.equal(h.latest().actor, null);
  await assert.rejects(h.api.execute({ action: "horse.save" }), /سجل الدخول/);
  assert.equal(h.signOuts(), 0); h.dispose();
});

test("actual service cached-only profile has a bounded recovery while keeping durable login", async () => {
  const h = harness(); await h.start();
  const profileTimeout = [...h.timers.values()].at(-1)!;
  h.deliverProfile(profile, true); h.deliverProfile(profile, true);
  assert.equal(h.timers.size, 2, "Cached callbacks do not restart or multiply the profile deadline");
  profileTimeout(); await flush();
  assert.equal(h.latest().phase, "waiting"); assert.equal(h.latest().actor, null);
  assert.match(h.latest().error, /صلاحيات الحساب/); assert.equal(h.signOuts(), 0);
  h.api.retryLoginSession(); await flush();
  h.deliverProfile(); h.deliver(fixture()); h.synchronize();
  assert.equal(h.latest().actor.dataReady, true); assert.equal(h.timers.size, 1);
  h.dispose();
});

test("actual service collection permission error discards data and ignores queued collection callbacks", async () => {
  const h = harness(); await h.start(); h.deliverProfile(); h.deliver(fixture()); h.synchronize();
  const listener = h.subscriptions.find(s => s.path === records.storageCollection("horses"))!;
  listener.error!({ code: "permission-denied", message: "permission revoked" }); await flush();
  assert.equal(h.latest().phase, "blocked");
  listener.next({ docs: [{ id: "stale", data: () => ({ name: "stale" }) }], metadata: { fromCache: false, hasPendingWrites: false } });
  h.synchronize(); assert.equal(h.latest().actor, null); assert.deepEqual(h.latest().state.horses, []);
  h.dispose();
});

test("actual service enforces seven original-auth days before any server access or data", async () => {
  const h = harness(Math.floor(Date.now() / 1000) - session.SESSION_SECONDS);
  await h.start(); await flush();
  assert.equal(h.latest().phase, "signed-out"); assert.equal(h.latest().actor, null);
  assert.equal(h.calls.length, 0); assert.equal(h.signOuts(), 1); h.dispose();
});

test("actual service ignores old listeners and a late maintenance result after account changes", async () => {
  const h = harness(), pending = deferred(); h.setOperate(() => pending.promise);
  await h.start(); h.deliverProfile(); h.deliver(domain.emptyState()); h.synchronize(); await flush();
  const oldProfile = h.subscriptions.find(s => s.path === `users/${admin.uid}`)!;
  const next = { ...h.user, uid: "second-member" }; h.auth.currentUser = next;
  await h.authChanged(next); pending.resolve(); await flush();
  oldProfile.next({ data: () => profile, metadata: { fromCache: false, hasPendingWrites: false } });
  h.synchronize(); assert.equal(h.latest().actor, null); assert.equal(h.latest().phase, "restoring");
  h.deliverProfile({ ...profile, uid: next.uid }); h.deliver(fixture()); h.synchronize();
  assert.equal(h.latest().actor.uid, next.uid); assert.equal(h.latest().actor.dataReady, true);
  h.dispose();
});

test("actual service exposes stalled snapshot recovery without auto-writing again or clearing login", async () => {
  const h = harness(); await h.start(); h.deliverProfile(); h.deliver(domain.emptyState()); h.synchronize(); await flush();
  assert.equal(h.latest().actor.dataReady, false);
  h.expireSnapshotWait(); await flush();
  assert.match(h.latest().error, /صحة تاريخ الجهاز/);
  assert.equal(h.latest().phase, "ready"); assert.equal(h.latest().actor.dataReady, false);
  assert.equal(h.signOuts(), 0); assert.equal(h.calls.filter(c => c.name === "operate").length, 1);
  assert.equal(h.timers.size, 1, "Only the seven-day session timer remains; no automatic financial retry");
  h.dispose();
});
