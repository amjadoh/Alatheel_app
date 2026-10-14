import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import {
  applyCommand,
  emptyState,
  collections,
  Actor,
  Command,
  Collection,
  ensure,
} from "./domain";
initializeApp();
const db = getFirestore(process.env.FIRESTORE_DATABASE_ID || "(default)");
const auth = getAuth();
const options = {
  region: process.env.FUNCTIONS_REGION || "us-central1",
  maxInstances: 5,
};
const needs: Record<string, Collection[]> = {
  "request.create": [],
  "request.review": ["registrationRequests"],
  "request.accept": ["registrationRequests", "horses"],
  "horse.save": ["horses", "users", "mealTypes"],
  "horse.checkout": ["horses"],
  "horse.restore": ["horses"],
  "meal.save": ["mealTypes"],
  "meal.delete": ["mealTypes", "horses"],
  "stock.move": ["mealTypes"],
  "expense.save": ["expenses", "horses"],
  "expense.delete": ["expenses"],
  "income.collect": ["horses", "expenses", "income"],
  "profile.save": ["users"],
  "settings.save": ["settings"],
};
export const ensureProfile = onCall(options, async (request) => {
  if (!request.auth)
    throw new HttpsError("unauthenticated", "سجل الدخول أولًا");
  const u = await auth.getUser(request.auth.uid);
  if (u.disabled) throw new HttpsError("permission-denied", "الحساب معطل");
  await db.runTransaction(async (tx) => {
    const ref = db.doc(`users/${u.uid}`),
      snap = await tx.get(ref);
    if (snap.exists) {
      if (snap.data()?.disabled)
        throw new HttpsError("permission-denied", "الحساب معطل");
      return;
    }
    tx.create(ref, {
      uid: u.uid,
      displayName: u.displayName || "عضو جديد",
      email: u.email || "",
      phoneNumber: u.phoneNumber || "",
      role: "viewer",
      disabled: false,
      createdAt: new Date().toISOString(),
    });
  });
  return { ok: true };
});
export const operate = onCall(options, async (request) => {
  if (!request.auth)
    throw new HttpsError("unauthenticated", "سجل الدخول أولًا");
  const c = request.data as Command;
  if (
    !c ||
    !Object.hasOwn(needs, c.action) ||
    !/^[a-zA-Z0-9_-]{6,100}$/.test(c.requestId)
  )
    throw new HttpsError("invalid-argument", "عملية غير معروفة");
  try {
    return await db.runTransaction(async (tx) => {
      const p = await tx.get(db.doc(`users/${request.auth!.uid}`));
      ensure(p.exists && !p.data()?.disabled, "الحساب غير متاح");
      const actor = { ...p.data(), uid: p.id } as Actor;
      const receipt = await tx.get(db.doc(`activities/${c.requestId}`));
      if (receipt.exists) {
        ensure(receipt.data()?.performedBy === actor.uid, "معرف عملية مستخدم");
        return { ok: true };
      }
      const state = emptyState();
      state.users = [{ id: p.id, ...p.data() }];
      // Read only collections required by the operation, inside the same transaction.
      for (const name of needs[c.action]) {
        const snapshot = await tx.get(db.collection(name).limit(4001));
        ensure(
          snapshot.size <= 4000,
          "حجم السجلات يتجاوز حد التشغيل الحالي؛ يلزم ترقية الاستعلامات قبل المتابعة",
        );
        state[name] = snapshot.docs.map((doc) => ({
          ...doc.data(),
          id: doc.id,
        }));
      }
      const next = applyCommand(state, actor, c);
      for (const name of collections) {
        const before = new Map(state[name].map((r) => [r.id, r]));
        for (const row of next[name]) {
          if (JSON.stringify(before.get(row.id)) !== JSON.stringify(row)) {
            const { id, ...value } = row;
            tx.set(db.doc(`${name}/${id}`), value);
          }
          before.delete(row.id);
        }
        for (const id of before.keys()) tx.delete(db.doc(`${name}/${id}`));
      }
      return { ok: true };
    });
  } catch (e) {
    if (e instanceof HttpsError) throw e;
    throw new HttpsError(
      "failed-precondition",
      e instanceof Error ? e.message : "تعذر حفظ العملية",
    );
  }
});
export const manageMember = onCall(options, async (request) => {
  if (!request.auth)
    throw new HttpsError("unauthenticated", "سجل الدخول أولًا");
  const caller = request.auth.uid,
    { action, data = {}, id } = request.data ?? {};
  const assertAdmin = async () => {
    const p = await db.doc(`users/${caller}`).get();
    ensure(
      p.data()?.role === "admin" && !p.data()?.disabled,
      "إدارة الأعضاء للمدير فقط",
    );
  };
  try {
    await assertAdmin();
    ensure(
      ["create", "update", "disable", "enable", "delete"].includes(action),
      "عملية غير معروفة",
    );
    if (action === "create") {
      ensure(
        ["owner", "employee"].includes(data.role),
        "أنشئ مالكًا أو موظفًا ثم عدل الصلاحية عند الحاجة",
      );
      ensure(
        typeof data.email === "string" &&
          /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email),
        "البريد غير صحيح",
      );
      ensure(
        data.displayName?.trim() && data.phoneNumber?.trim(),
        "أكمل الاسم والجوال",
      );
      let u;
      try {
        u = await auth.getUserByEmail(data.email.trim());
      } catch (e: any) {
        if (e.code !== "auth/user-not-found") throw e;
        u = await auth.createUser({
          email: data.email.trim(),
          displayName: data.displayName.trim(),
          emailVerified: false,
        });
      }
      await db.runTransaction(async (tx) => {
        const p = await tx.get(db.doc(`users/${caller}`));
        ensure(
          p.data()?.role === "admin" && !p.data()?.disabled,
          "لا تملك الصلاحية",
        );
        const ref = db.doc(`users/${u.uid}`),
          old = await tx.get(ref);
        ensure(!old.exists, "العضو مسجل بالفعل؛ استخدم تعديل العضو");
        tx.create(ref, {
          uid: u.uid,
          email: u.email,
          displayName: data.displayName.trim().slice(0, 100),
          phoneNumber: data.phoneNumber.trim().slice(0, 30),
          role: data.role,
          disabled: false,
          createdAt: new Date().toISOString(),
        });
      });
      await db
        .collection("activities")
        .add({
          action: "member.create",
          performedBy: caller,
          ownerId: u.uid,
          createdAt: new Date().toISOString(),
        });
      return { ok: true, uid: u.uid };
    }
    ensure(
      typeof id === "string" && id !== caller,
      "لا يمكنك تغيير صلاحيتك أو تعطيل وحذف حسابك من هذه الشاشة",
    );
    const ref = db.doc(`users/${id}`);
    // Lock the profile first. Every client rule and operation checks disabled.
    await db.runTransaction(async (tx) => {
      const admin = await tx.get(db.doc(`users/${caller}`)),
        target = await tx.get(ref);
      ensure(
        admin.data()?.role === "admin" && !admin.data()?.disabled,
        "لا تملك الصلاحية",
      );
      ensure(target.exists, "العضو غير موجود");
      if (action === "delete") {
        const horses = await tx.get(
          db.collection("horses").where("ownerId", "==", id),
        );
        ensure(
          !horses.docs.some((h) => h.data().status !== "archived"),
          "لا يمكن حذف عضو مرتبط بخيل نشط",
        );
      }
      if (action === "update") {
        ensure(
          ["admin", "employee", "owner", "viewer"].includes(data.role),
          "الصلاحية غير صحيحة",
        );
        ensure(
          data.displayName?.trim() && data.phoneNumber?.trim(),
          "أكمل الاسم والجوال",
        );
        tx.update(ref, {
          role: data.role,
          displayName: data.displayName.trim().slice(0, 100),
          phoneNumber: data.phoneNumber.trim().slice(0, 30),
        });
      } else tx.update(ref, { disabled: true, authSyncPending: true });
    });
    if (action === "delete") {
      try {
        await auth.deleteUser(id);
      } catch (e: any) {
        if (e.code !== "auth/user-not-found") throw e;
      }
      await ref.update({
        deleted: true,
        authSyncPending: false,
        deletedAt: new Date().toISOString(),
      });
    }
    if (action === "disable" || action === "enable") {
      await auth.updateUser(id, { disabled: action === "disable" });
      await auth.revokeRefreshTokens(id);
      await ref.update({
        disabled: action === "disable",
        authSyncPending: false,
      });
    }
    await db
      .collection("activities")
      .add({
        action: "member." + action,
        performedBy: caller,
        ownerId: id,
        createdAt: new Date().toISOString(),
      });
    return { ok: true };
  } catch (e) {
    throw new HttpsError(
      "failed-precondition",
      e instanceof Error ? e.message : "تعذر تحديث العضو؛ أعد المحاولة",
    );
  }
});
