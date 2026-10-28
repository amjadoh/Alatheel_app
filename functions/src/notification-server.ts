import { pushDeliveryPlan, pushDeliveryResults } from "./push-delivery";
import { createHash } from "node:crypto";
import { getMessaging } from "firebase-admin/messaging";
import {
  Timestamp,
  type Firestore,
  type Transaction,
} from "firebase-admin/firestore";
import { onCall } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import {
  onDocumentCreated,
  onDocumentWritten,
} from "firebase-functions/v2/firestore";
import { emptyState, ensure, type State, type Collection } from "./domain";
import { normalizeRecord, storageCollection } from "./records";
import { consumeScheduledFeeding } from "./feeding-stock";
import { previousFeedingDay } from "./feeding";
import {
  collectionDueAlerts,
  stockAlert,
  eligibleStaff,
  eligiblePushUser,
  eligibleAlertRecipient,
  allowedAlertKinds,
  appUpdateAlert,
  deliveryDecision,
  pushCopy,
  riyadhClock,
  type StaffAlert,
} from "./alerts";
import { resolveAccess } from "./access";
import { sessionExpiresAt } from "./session-policy";

const digest = (s: string) =>
  createHash("sha256").update(s).digest("hex").slice(0, 40);
export function notificationFunctions(
  db: Firestore,
  databaseId: string,
  options: { region: string; maxInstances: number },
  verify: (request: any) => Promise<any>,
  sendPush: (message:any)=>Promise<{responses:{success:boolean;error?:{code?:string}}[]}> = message=>getMessaging().sendEachForMulticast(message),
) {
  async function readState(tx: Transaction, names: Collection[]) {
    const state = emptyState();
    for (const name of names) {
      const snap = await tx.get(
        db.collection(storageCollection(name)).limit(4001),
      );
      ensure(snap.size <= 4000, "يلزم ترقية حجم السجلات قبل المزامنة");
      state[name] = snap.docs.map((d) => normalizeRecord(name, d.id, d.data()));
    }
    return state;
  }
  function saveChanges(
    tx: Transaction,
    before: State,
    after: State,
    names: Collection[],
  ) {
    let count = 0;
    for (const name of names) {
      const old = new Map(before[name].map((x) => [x.id, JSON.stringify(x)]));
      for (const row of after[name])
        if (old.get(row.id) !== JSON.stringify(row)) {
          count++;
          const { id, ...data } = row;
          for (const k of ["createdAt", "updatedAt"])
            if (typeof data[k] === "string")
              data[k] = Timestamp.fromDate(new Date(data[k]));
          tx.set(db.doc(`${storageCollection(name)}/${id}`), data);
        }
    }
    ensure(count <= 450, "حجم المزامنة يحتاج تقسيمًا؛ لم تُحفظ حركة جزئية");
  }
  function createAlerts(
    tx: Transaction,
    alerts: StaffAlert[],
    users: State["users"],
    now: string,
  ) {
    // Event IDs are deterministic, and the event marker is written atomically with all recipient alerts.
    for (const alert of alerts)
      for (const u of users.filter((user) => eligibleAlertRecipient(alert, user))) {
        const id = digest(alert.key);
        tx.create(db.doc(`users/${u.id}/staffAlerts/${id}`), {
          ...alert,
          userId: u.id,
          read: false,
          createdAt: now,
          deliveryState: "pending",
        });
      }
  }
  async function evaluateInventory(mealId?: string) {
    const now = new Date().toISOString();
    await db.runTransaction(async (tx) => {
      const state = await readState(tx, ["mealTypes", "users"]);
      const meals = state.mealTypes.filter((m) => !mealId || m.id === mealId);
      const old = await Promise.all(
        meals.map((m) => tx.get(db.doc(`stockAlertState/${m.id}`))),
      );
      const events: StaffAlert[] = [];
      for (let i = 0; i < meals.length; i++) {
        const next = stockAlert(
          meals[i],
          old[i].exists ? (old[i].data() as any) : undefined,
        );
        if (JSON.stringify(old[i].data()) !== JSON.stringify(next.state))
          tx.set(old[i].ref, next.state);
        if (next.alert) events.push(next.alert);
      }
      ensure(
        events.length * state.users.filter(eligibleStaff).length +
          meals.length <=
          450,
        "حجم تنبيهات المخزون يحتاج تقسيمًا",
      );
      createAlerts(tx, events, state.users, now);
    });
  }
  async function sweepFeeding() {
    const now = new Date().toISOString(),
      today = riyadhClock(now).day;
    await db.runTransaction(async (tx) => {
      const before = await readState(tx, [
        "horses",
        "mealTypes",
        "inventoryTransactions",
      ]);
      const after = consumeScheduledFeeding(
        before,
        previousFeedingDay(today),
        now,
      );
      saveChanges(tx, before, after, ["mealTypes", "inventoryTransactions"]);
    });
  }
  const updatePushDevice = onCall(options, async (request) => {
    const { identity } = await verify(request),
      uid = request.auth!.uid;
    const { deviceId, token, enabled, action, kinds, installedVersionCode } =
      request.data || {};
    ensure(
      typeof deviceId === "string" && /^[A-Za-z0-9_-]{16,100}$/.test(deviceId),
      "معرف الجهاز غير صالح",
    );
    await db.runTransaction(async (tx) => {
      const profile = await tx.get(db.doc(`users/${uid}`));
      resolveAccess(identity, profile.data());
      const user = { ...profile.data(), id: profile.id } as any;
      ensure(
        profile.exists && eligiblePushUser(user),
        "الحساب غير متاح للإشعارات",
      );
      const ref = db.doc(`pushDevices/${deviceId}`),
        old = await tx.get(ref);
      if (action === "remove") {
        if (old.data()?.userId === uid) tx.delete(ref);
        return;
      }
      ensure(
        typeof token === "string" && token.length >= 20 && token.length <= 4096,
        "تعذر تسجيل إشعارات الجهاز",
      );
      const devices = await tx.get(
        db.collection("pushDevices").where("userId", "==", uid).limit(11),
      );
      ensure(
        old.data()?.userId === uid || devices.size < 10,
        "وصل الحساب إلى الحد الأقصى للأجهزة",
      );
      const allowed = allowedAlertKinds(user);
      ensure(
        kinds === undefined ||
          (Array.isArray(kinds) &&
            kinds.every((k: any) => allowed.includes(k))),
        "أنواع الإشعارات غير صالحة",
      );
      ensure(
        installedVersionCode === undefined ||
          (Number.isSafeInteger(installedVersionCode) &&
            installedVersionCode > 0 &&
            installedVersionCode <= 1000000),
        "رقم إصدار الجهاز غير صالح",
      );
      tx.set(ref, {
        userId: uid,
        token,
        enabled: enabled === true,
        kinds: (kinds || old.data()?.kinds || allowed).filter((k: string) =>
          allowed.includes(k as any),
        ),
        installedVersionCode:
          installedVersionCode ?? old.data()?.installedVersionCode ?? 0,
        sessionExpiresAt: sessionExpiresAt(request.auth!.token.auth_time),
        updatedAt: new Date().toISOString(),
      });
    });
    return { ok: true };
  });
  const synchronizeFeeding = onSchedule(
    {
      ...options,
      schedule: "5 * * * *",
      timeZone: "Asia/Riyadh",
      retryCount: 3,
    },
    async () => {
      await sweepFeeding();
      await evaluateInventory();
    },
  );
  const remindCollections = onSchedule(
    {
      ...options,
      schedule: "0 21 * * *",
      timeZone: "Asia/Riyadh",
      retryCount: 3,
    },
    async () => {
      const now = new Date().toISOString(),
        clock = riyadhClock(now);
      if (clock.hour < 21) return;
      await db.runTransaction(async (tx) => {
        const state = await readState(tx, [
          "horses",
          "expenses",
          "income",
          "users",
        ]);
        const planned = collectionDueAlerts(state, clock.day);
        const markers = await Promise.all(
          planned.map((a) =>
            tx.get(db.doc(`staffAlertEvents/${digest(a.key)}`)),
          ),
        );
        const fresh = planned.filter((_, i) => !markers[i].exists);
        ensure(
          fresh.length * (state.users.filter(eligibleStaff).length + 1) <= 450,
          "حجم تنبيهات التحصيل يحتاج تقسيمًا",
        );
        fresh.forEach((a) =>
          tx.create(db.doc(`staffAlertEvents/${digest(a.key)}`), {
            createdAt: now,
            key: a.key,
          }),
        );
        createAlerts(tx, fresh, state.users, now);
      });
    },
  );
  const inventoryAlert = onDocumentWritten(
    { ...options, database: databaseId, document: "mealTypes/{mealId}" },
    async (event) => {
      if (event.data?.after.exists)
        await evaluateInventory(event.params.mealId);
    },
  );
  const discoverAppUpdates = onSchedule(
    {
      ...options,
      schedule: "15 * * * *",
      timeZone: "Asia/Riyadh",
      retryCount: 0,
    },
    async () => {
      for (const channel of ["stable", "beta"] as const) {
        const response = await fetch(
          `https://alatheel-app-426403695200.web.app/${channel === "beta" ? "beta/" : ""}latest.json`,
          { signal: AbortSignal.timeout(15000), cache: "no-store" },
        );
        if (channel === "beta" && response.status === 404) continue;
        ensure(response.ok, "تعذر قراءة الإصدار المنشور");
        const text = await response.text();
        ensure(text.length <= 12000, "بيانات الإصدار أكبر من الحد المسموح");
        const manifest = JSON.parse(text);
        ensure((manifest.channel || "stable") === channel, "قناة الإصدار لا تطابق مسار الإعلان");
        if (Number(manifest.versionCode) < 10) continue;
        const alert = appUpdateAlert(manifest),
          now = new Date().toISOString();
        await db.runTransaction(async (tx) => {
          const state = await readState(tx, ["users"]),
            ref = db.doc(`appUpdateState/${channel === "beta" ? "beta" : "current"}`),
            old = await tx.get(ref);
          if (Number(old.data()?.versionCode || 0) >= manifest.versionCode)
            return;
          ensure(
            state.users.filter((user) => eligibleAlertRecipient(alert, user)).length < 449,
            "حجم إعلان الإصدار يحتاج تقسيمًا",
          );
          tx.set(ref, {
            channel,
            versionCode: manifest.versionCode,
            versionName: manifest.versionName,
            sha256: manifest.sha256,
            announcedAt: now,
          });
          createAlerts(tx, [alert], state.users, now);
        });
      }
    },
  );
  async function deliver(
    ref: FirebaseFirestore.DocumentReference,
    userId: string,
    alertId: string,
  ) {
    const now = Date.now();
    const alert = await db.runTransaction(async (tx) => {
      const [snap, p] = await Promise.all([
        tx.get(ref),
        tx.get(db.doc(`users/${userId}`)),
      ]);
      if (!snap.exists) return null;
      const a = snap.data()!,
        decision = deliveryDecision({ id: snap.id, ...a }, now);
      if (decision === "done" || decision === "leased") return null;
      if (decision !== "ready") {
        tx.update(ref, {
          deliveryState: decision === "limit" ? "failed" : "cancelled",
          leaseUntil: 0,
        });
        return null;
      }
      if (
        !eligibleAlertRecipient(a as StaffAlert, { ...p.data(), id: p.id } as any) ||
        !allowedAlertKinds({ ...p.data(), id: p.id } as any).includes(a.kind)
      ) {
        tx.update(ref, { deliveryState: "cancelled", leaseUntil: 0 });
        return null;
      }
      let relevant = true;
      if (a.kind === "collection_due") {
        const current = await readState(tx, ["horses", "expenses", "income"]);
        relevant = collectionDueAlerts(
          current,
          riyadhClock(new Date().toISOString()).day,
        ).some((x) => x.key === a.key);
      } else if(a.kind==="app_feedback") {
        const feedback=await tx.get(db.doc("appFeedback/"+a.feedbackId));
        relevant=feedback.exists&&feedback.data()?.syncState!=="draft"&&String(p.data()?.email).toLowerCase()==="amjadoh@gmail.com";
      } else if (a.kind === "app_update") {
        const current = await tx.get(db.doc(`appUpdateState/${a.channel === "beta" ? "beta" : "current"}`));
        relevant = current.data()?.versionCode === a.versionCode;
      } else {
        const current = await tx.get(db.doc(`mealTypes/${a.mealTypeId}`));
        const phase = await tx.get(db.doc(`stockAlertState/${a.mealTypeId}`));
        relevant =
          current.exists &&
          phase.exists &&
          a.key ===
            `stock_${a.mealTypeId}_${phase.data()?.phase}_${phase.data()?.sequence}`;
      }
      if (!relevant) {
        tx.update(ref, { deliveryState: "cancelled", leaseUntil: 0 });
        return null;
      }
      tx.update(ref, {
        deliveryState: "sending",
        leaseUntil: now + 120000,
        deliveryAttempts: Number(a.deliveryAttempts || 0) + 1,
      });
      return a;
    });
    if (!alert) return;
    try {
      const devices = await db
        .collection("pushDevices")
        .where("userId", "==", userId)
        .get();
      const plan = pushDeliveryPlan(devices.docs.map(d=>({id:d.id,...d.data()})), alert as StaffAlert);
      const selected = devices.docs.filter(d=>plan.targets.some(t=>t.id===d.id));
      if (!selected.length) {
        await ref.update({deliveryState:plan.idleState,leaseUntil:0,
          deliveryAttempts:Number(alert.deliveryAttempts||0),pushTargetCount:0,
          pushSuccessCount:(alert.pushDeliveredDeviceIds||[]).length,
          pushStatusReason:plan.idleState==="not_needed" ? "already_current" : plan.idleState==="sent" ? "previously_accepted" : "no_eligible_device",
          ...(plan.idleState!=="sent" ? {deliveredAt:null} : {})});
        return;
      }
      const copy = pushCopy(alert.kind, alert.channel);
      const result = await sendPush({
        tokens:selected.map(d=>d.data().token),data:{...copy,alertId,userId,kind:alert.kind},
        android:{priority:"high",ttl:alert.kind==="collection_due" ? 3*3600000 : 24*3600000,collapseKey:alertId},
      });
      const outcome=pushDeliveryResults(selected.map(d=>d.id),result.responses,alert.pushDeliveredDeviceIds||[]);
      // Persist accepted device IDs before cleanup, so a partial retry does not
      // send another notification to devices that already accepted this alert.
      await ref.update({deliveryState:outcome.state,leaseUntil:0,pushTargetCount:selected.length,
        pushSuccessCount:outcome.successCount,pushTransientCount:outcome.transientCount,
        pushInvalidCount:outcome.invalidIds.length,pushDeliveredDeviceIds:outcome.deliveredIds,
        lastPushAttemptAt:new Date().toISOString(),
        pushStatusReason:outcome.state==="sent" ? "messaging_accepted" : outcome.state==="pending" ? "temporary_failure" : "invalid_device_token",
        deliveredAt:outcome.successCount ? new Date().toISOString() : null});
      await Promise.all(outcome.invalidIds.map(id=>devices.docs.find(d=>d.id===id)!.ref.delete()));
    } catch (error) {
      await ref.update({ deliveryState: "pending", leaseUntil: 0 });
    }
  }
  // No unbounded Eventarc retries. A bounded sweep offers at most 3 attempts / 24h.
  const deliverStaffAlert = onDocumentCreated(
    {
      ...options,
      database: databaseId,
      document: "users/{userId}/staffAlerts/{alertId}",
      retry: false,
    },
    async (event) => {
      if (event.data)
        await deliver(
          event.data.ref,
          event.params.userId,
          event.params.alertId,
        );
    },
  );
  const retryPendingAlerts = onSchedule(
    {
      ...options,
      timeoutSeconds: 540,
      schedule: "35 * * * *",
      timeZone: "Asia/Riyadh",
      retryCount: 0,
    },
    async () => {
      const users = await db.collection("users").limit(4001).get();
      ensure(users.size <= 4000, "يلزم تقسيم سجل الإشعارات");
      let processed = 0;
      for (const u of users.docs) {
        if (!eligiblePushUser({ ...u.data(), id: u.id } as any)) continue;
        const rows = await u.ref
          .collection("staffAlerts")
          .where("deliveryState", "in", ["pending", "sending", "waiting_device"])
          .limit(Math.min(25, 50 - processed))
          .get();
        for (const row of rows.docs) {
          await deliver(row.ref, u.id, row.id);
          if (++processed >= 50) return;
        }
      }
    },
  );
  return {
    updatePushDevice,
    synchronizeFeeding,
    remindCollections,
    inventoryAlert,
    deliverStaffAlert,
    discoverAppUpdates,
    retryPendingAlerts,
  };
}
