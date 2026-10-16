import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { defineSecret } from "firebase-functions/params";
import { createTransport } from "nodemailer";
import { invitationMessage, invitationFailureCode } from "./invitations";
import { error as logError } from "firebase-functions/logger";
import { assertOwnerLink, invitationRequested } from "./owners";
import { storageCollection, normalizeRecord } from "./records";
import {
  applyCommand,
  emptyState,
  collections,
  Actor,
  Command,
  Collection,
  ensure,
} from "./domain";
import {
  requireGoogle,
  resolveAccess,
  normalizeEmail,
  PRIMARY_ADMIN_EMAIL,
} from "./access";
initializeApp();
const databaseId =
  process.env.FIRESTORE_DATABASE_ID ||
  "ai-studio-3316cd3a-14d1-4f71-adec-897324c5bb0e";
const db = getFirestore(databaseId);
const auth = getAuth();
const invitationsEnabled = process.env.INVITATIONS_ENABLED === "true";
const options = {
  region: process.env.FUNCTIONS_REGION || "us-central1",
  maxInstances: 5,
};
const needs: Record<string, Collection[]> = {
  "owner.save": ["owners", "horses"],
  "request.create": [],
  "request.review": ["registrationRequests"],
  "request.accept": ["registrationRequests", "horses"],
  "horse.save": [
    "horses",
    "owners",
    "users",
    "mealTypes",
    "income",
    "expenses",
  ],
  "horse.checkout": ["horses"],
  "horse.restore": ["horses"],
  "meal.save": ["mealTypes"],
  "meal.delete": ["mealTypes", "horses"],
  "stock.move": ["mealTypes"],
  "expense.save": ["expenses", "horses", "mealTypes", "expensePayments"],
  "expense.delete": ["expenses", "expensePayments"],
  "expense.pay": ["expenses", "expensePayments"],
  "expense.payment.void": ["expensePayments"],
  "finance.snapshot": [
    "horses",
    "expenses",
    "mealTypes",
    "income",
    "expensePayments",
    "financialReports",
  ],
  "income.collect": ["horses", "expenses", "income"],
  "income.pay": ["horses", "expenses", "income"],
  "profile.save": ["users"],
  "settings.save": ["settings"],
};
async function verifiedGoogle(request: { auth?: { uid: string; token: any } }) {
  if (!request.auth)
    throw new HttpsError("unauthenticated", "سجل الدخول بحساب Google أولًا");
  const u = await auth.getUser(request.auth.uid);
  const identity = {
    email: u.email,
    emailVerified:
      u.emailVerified && request.auth.token.email_verified === true,
    signInProvider: request.auth.token.firebase?.sign_in_provider,
    disabled: u.disabled,
  };
  try {
    requireGoogle(identity);
  } catch (e) {
    throw new HttpsError(
      "permission-denied",
      e instanceof Error ? e.message : "الدخول غير مسموح",
    );
  }
  return { u, identity };
}
export const ensureProfile = onCall(options, async (request) => {
  const { u, identity } = await verifiedGoogle(request);
  try {
    await db.runTransaction(async (tx) => {
      const ref = db.doc(`users/${u.uid}`),
        snap = await tx.get(ref);
      const role = resolveAccess(
        identity,
        snap.exists ? snap.data() : undefined,
      );
      if (!snap.exists) {
        tx.create(ref, {
          uid: u.uid,
          displayName: u.displayName || "مدير الإسطبل",
          email: u.email,
          phoneNumber: u.phoneNumber || "",
          role,
          disabled: false,
          membershipApproved: true,
          createdAt: new Date().toISOString(),
        });
      } else if (
        snap.data()?.role !== role ||
        snap.data()?.disabled === undefined ||
        (role === "admin" &&
          identity.email?.toLowerCase() === PRIMARY_ADMIN_EMAIL &&
          !snap.data()?.membershipApproved)
      ) {
        tx.update(ref, { role, disabled: false, membershipApproved: true });
      }
    });
  } catch (e) {
    throw new HttpsError(
      "permission-denied",
      e instanceof Error ? e.message : "الدخول غير مسموح",
    );
  }
  return { ok: true };
});
export const operate = onCall(options, async (request) => {
  const { identity } = await verifiedGoogle(request);
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
      resolveAccess(identity, p.exists ? p.data() : undefined);
      ensure(p.exists, "الحساب غير متاح");
      const actor = { ...p.data(), uid: p.id } as Actor;
      const receipt = await tx.get(db.doc(`activities/${c.requestId}`));
      if (receipt.exists) {
        ensure(receipt.data()?.performedBy === actor.uid, "معرف عملية مستخدم");
        return { ok: true };
      }
      const state = emptyState();
      state.users = [normalizeRecord("users", p.id, p.data()!)];
      // Read only collections required by the operation, inside the same transaction.
      for (const name of needs[c.action]) {
        const snapshot = await tx.get(
          db.collection(storageCollection(name)).limit(4001),
        );
        ensure(
          snapshot.size <= 4000,
          "حجم السجلات يتجاوز حد التشغيل الحالي؛ يلزم ترقية الاستعلامات قبل المتابعة",
        );
        state[name] = snapshot.docs.map((doc) =>
          normalizeRecord(name, doc.id, doc.data()),
        );
      }
      if (["income.collect", "income.pay"].includes(c.action))
        ensure(
          !state.expenses.some(
            (e) =>
              e.frequency === "once" &&
              e.horseIds?.includes(c.id) &&
              !e.allocations,
          ),
          "توجد مصروفات قديمة تحتاج اعتماد توزيعها من المدير قبل التحصيل",
        );
      const next = applyCommand(state, actor, c);
      for (const name of collections) {
        const before = new Map(state[name].map((r) => [r.id, r]));
        for (const row of next[name]) {
          if (JSON.stringify(before.get(row.id)) !== JSON.stringify(row)) {
            const { id, ...value } = row;
            for (const key of ["createdAt", "updatedAt", "collectedAt"])
              if (typeof value[key] === "string")
                value[key] = Timestamp.fromDate(new Date(value[key]));
            if (name === "income") {
              value.dueDate = Timestamp.fromDate(new Date(value.dueDate));
              value.status = "collected";
            }
            tx.set(db.doc(`${storageCollection(name)}/${id}`), value);
          }
          before.delete(row.id);
        }
        for (const id of before.keys())
          tx.delete(db.doc(`${storageCollection(name)}/${id}`));
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
  const { identity } = await verifiedGoogle(request);
  const caller = request.auth!.uid,
    { action, data = {}, id } = request.data ?? {};
  const assertAdmin = async () => {
    const p = await db.doc(`users/${caller}`).get();
    resolveAccess(identity, p.exists ? p.data() : undefined);
    ensure(
      p.data()?.role === "admin" && !p.data()?.disabled,
      "إدارة الأعضاء للمدير فقط",
    );
  };
  try {
    await assertAdmin();
    ensure(
      ["create", "update", "disable", "enable", "delete", "invite"].includes(
        action,
      ),
      "عملية غير معروفة",
    );
    if (action === "create") {
      ensure(
        ["admin", "owner", "employee", "viewer"].includes(data.role),
        "حدد صلاحية العضو",
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
        u = await auth.getUserByEmail(normalizeEmail(data.email));
      } catch (e: any) {
        if (e.code !== "auth/user-not-found") throw e;
        u = await auth.createUser({
          email: normalizeEmail(data.email),
          displayName: data.displayName.trim(),
          emailVerified: false,
        });
      }
      await db.runTransaction(async (tx) => {
        const p = await tx.get(db.doc(`users/${caller}`));
        resolveAccess(identity, p.exists ? p.data() : undefined);
        ensure(
          p.data()?.role === "admin" && !p.data()?.disabled,
          "لا تملك الصلاحية",
        );
        const ref = db.doc(`users/${u.uid}`),
          old = await tx.get(ref);
        ensure(
          !old.exists ||
            (!old.data()?.membershipApproved &&
              !old.data()?.disabled &&
              !old.data()?.deleted),
          "العضو مسجل بالفعل؛ استخدم تعديل العضو",
        );
        const ownerId =
          data.ownerRecordId || (data.role === "owner" ? u.uid : "");
        ensure(
          !ownerId || /^[a-zA-Z0-9_-]{1,128}$/.test(ownerId),
          "معرف المالك غير صحيح",
        );
        const ownerRef = ownerId ? db.doc(`owners/${ownerId}`) : null;
        const ownerSnap = ownerRef ? await tx.get(ownerRef) : null;
        if (data.ownerRecordId || ownerSnap?.exists) {
          assertOwnerLink(
            ownerSnap?.exists
              ? { ...ownerSnap.data(), id: ownerId }
              : undefined,
            u.uid,
            u.email!,
            old.data()?.ownerRecordId,
          );
          const legacy = await tx.get(
            db.collection("horses").where("ownerId", "==", u.uid).limit(1),
          );
          ensure(
            ownerId === u.uid || legacy.empty,
            "الحساب مرتبط بخيل قديمة؛ يلزم توحيد سجل المالك قبل الربط",
          );
        }
        if (ownerRef)
          tx.set(
            ownerRef,
            {
              ...(!ownerSnap?.exists
                ? {
                    displayName: data.displayName.trim().slice(0, 100),
                    phoneNumber: data.phoneNumber.trim().slice(0, 30),
                    email: u.email,
                    notes: "",
                    createdAt: Timestamp.now(),
                  }
                : {}),
              linkedUserId: u.uid,
              updatedAt: Timestamp.now(),
            },
            { merge: true },
          );
        const inviteRef = db.collection("memberInvitations").doc();
        const sendInvite = invitationRequested(data);
        tx.set(ref, {
          uid: u.uid,
          email: u.email,
          displayName: data.displayName.trim().slice(0, 100),
          phoneNumber: data.phoneNumber.trim().slice(0, 30),
          role: data.role,
          disabled: false,
          membershipApproved: true,
          approvedBy: caller,
          ...(ownerId ? { ownerRecordId: ownerId } : {}),
          invitationStatus: sendInvite
            ? invitationsEnabled
              ? "queued"
              : "setup_required"
            : "not_sent",
          ...(sendInvite ? { invitationId: inviteRef.id } : {}),
          createdAt: new Date().toISOString(),
        });
        if (sendInvite)
          tx.create(inviteRef, {
            userId: u.uid,
            email: u.email,
            displayName: data.displayName.trim(),
            status: invitationsEnabled ? "queued" : "setup_required",
            createdBy: caller,
            createdAt: new Date().toISOString(),
          });
      });
      await db.collection("activities").add({
        action: "member.create",
        performedBy: caller,
        ownerId: u.uid,
        createdAt: new Date().toISOString(),
      });
      return { ok: true, uid: u.uid };
    }
    ensure(
      typeof id === "string" && (action === "invite" || id !== caller),
      "لا يمكنك تغيير صلاحيتك أو تعطيل وحذف حسابك من هذه الشاشة",
    );
    const ref = db.doc(`users/${id}`);
    // Lock the profile first. Every client rule and operation checks disabled.
    await db.runTransaction(async (tx) => {
      const admin = await tx.get(db.doc(`users/${caller}`)),
        target = await tx.get(ref);
      resolveAccess(identity, admin.exists ? admin.data() : undefined);
      ensure(
        admin.data()?.role === "admin" && !admin.data()?.disabled,
        "لا تملك الصلاحية",
      );
      ensure(target.exists && !target.data()?.deleted, "العضو غير موجود");
      if (action === "invite") {
        ensure(
          invitationsEnabled,
          "إرسال الدعوات لم يُفعّل بعد؛ يلزم ربط بريد الإسطبل",
        );
        ensure(
          !target.data()?.disabled &&
            target.data()?.membershipApproved === true,
          "اعتمد العضو وفعّله قبل إرسال الدعوة",
        );
        const inviteRef = db.collection("memberInvitations").doc();
        tx.update(ref, {
          invitationStatus: "queued",
          invitationId: inviteRef.id,
        });
        tx.create(inviteRef, {
          userId: id,
          email: target.data()?.email,
          displayName: target.data()?.displayName,
          status: "queued",
          createdBy: caller,
          createdAt: new Date().toISOString(),
        });
        return;
      }
      ensure(
        normalizeEmail(target.data()?.email || "") !== PRIMARY_ADMIN_EMAIL,
        "لا يمكن تغيير صلاحية المدير الأساسي أو تعطيل وحذف حسابه",
      );
      if (action === "delete") {
        const horses = await tx.get(
          db
            .collection("horses")
            .where("ownerId", "==", target.data()?.ownerRecordId || id),
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
        const ownerId =
          data.ownerRecordId || target.data()?.ownerRecordId || "";
        ensure(
          !ownerId || /^[a-zA-Z0-9_-]{1,128}$/.test(ownerId),
          "معرف المالك غير صحيح",
        );
        const ownerRef = ownerId ? db.doc(`owners/${ownerId}`) : null;
        const ownerSnap = ownerRef ? await tx.get(ownerRef) : null;
        if (ownerRef) {
          assertOwnerLink(
            ownerSnap?.exists
              ? { ...ownerSnap.data(), id: ownerId }
              : undefined,
            id,
            target.data()?.email,
            target.data()?.ownerRecordId,
          );
          const legacy = await tx.get(
            db.collection("horses").where("ownerId", "==", id).limit(1),
          );
          ensure(
            ownerId === id || legacy.empty,
            "الحساب مرتبط بخيل قديمة؛ يلزم توحيد سجل المالك قبل الربط",
          );
          tx.update(ownerRef, { linkedUserId: id, updatedAt: Timestamp.now() });
        }
        tx.update(ref, {
          role: data.role,
          membershipApproved: true,
          approvedBy: caller,
          disabled: target.data()?.disabled === true,
          displayName: data.displayName.trim().slice(0, 100),
          phoneNumber: data.phoneNumber.trim().slice(0, 30),
          ...(ownerId ? { ownerRecordId: ownerId } : {}),
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
      const deletedMember = await ref.get();
      if (deletedMember.data()?.ownerRecordId) {
        const ownerRef = db.doc(
          `owners/${deletedMember.data()!.ownerRecordId}`,
        );
        await db.runTransaction(async (tx) => {
          const owner = await tx.get(ownerRef);
          if (owner.exists && owner.data()?.linkedUserId === id)
            tx.update(ownerRef, {
              linkedUserId: "",
              updatedAt: Timestamp.now(),
            });
        });
      }
    }
    if (action === "disable" || action === "enable") {
      await auth.updateUser(id, { disabled: action === "disable" });
      await auth.revokeRefreshTokens(id);
      await ref.update({
        disabled: action === "disable",
        authSyncPending: false,
      });
    }
    await db.collection("activities").add({
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
const smtpPassword = invitationsEnabled
  ? defineSecret("MEMBER_INVITATION_SMTP_PASSWORD")
  : null;
export const sendMemberInvitation = invitationsEnabled
  ? onDocumentCreated(
      {
        ...options,
        database: databaseId,
        document: "memberInvitations/{invitationId}",
        secrets: [smtpPassword!],
        retry: false,
      },
      async (event) => {
        const ref = event.data?.ref;
        if (!ref) return;
        const invitation = await db.runTransaction(async (tx) => {
          const snap = await tx.get(ref);
          if (snap.data()?.status !== "queued") return null;
          const data = snap.data()!;
          const memberRef = db.doc(`users/${data.userId}`),
            member = await tx.get(memberRef);
          if (
            !member.exists ||
            member.data()?.disabled ||
            member.data()?.deleted ||
            member.data()?.membershipApproved !== true ||
            member.data()?.invitationId !== ref.id
          ) {
            tx.update(ref, { status: "cancelled" });
            return null;
          }
          tx.update(ref, { status: "sending" });
          tx.update(memberRef, { invitationStatus: "sending" });
          return data;
        });
        if (!invitation) return;
        let status = "failed";
        let stage: "download" | "smtp" = "download";
        let failureCode = "";
        try {
          const downloadUrl =
            process.env.APP_DOWNLOAD_URL ||
            "https://alatheel-app-426403695200.web.app/downloads/Alatheel-latest.apk";
          const download = await fetch(downloadUrl, {
            method: "HEAD",
            signal: AbortSignal.timeout(10000),
          });
          if (!download.ok)
            throw new Error("Latest APK download is unavailable");
          stage = "smtp";
          const transport = createTransport({
            host: process.env.INVITATION_SMTP_HOST || "smtp.gmail.com",
            port: 465,
            secure: true,
            connectionTimeout: 15000,
            greetingTimeout: 15000,
            socketTimeout: 20000,
            auth: {
              user: process.env.INVITATION_MAIL_USER || "amjadoh@gmail.com",
              pass: smtpPassword!.value().replace(/\s/g, ""),
            },
          });
          await transport.sendMail({
            from:
              process.env.INVITATION_FROM || "إسطبل الأثيل <amjadoh@gmail.com>",
            to: invitation.email,
            messageId: `<alatheel-invite-${ref.id}@gen-lang-client-0145196991.firebaseapp.com>`,
            ...invitationMessage(
              invitation.displayName,
              invitation.email,
              downloadUrl,
            ),
          });
          status = "sent";
        } catch (e) {
          failureCode = invitationFailureCode(e, stage);
          logError("Invitation delivery failed", {
            invitationId: ref.id,
            failureCode,
          });
        }
        await db.runTransaction(async (tx) => {
          const memberRef = db.doc(`users/${invitation.userId}`),
            member = await tx.get(memberRef);
          tx.update(ref, {
            status,
            failureCode,
            finishedAt: new Date().toISOString(),
          });
          if (member.data()?.invitationId === ref.id)
            tx.update(memberRef, {
              invitationStatus: status,
              invitationUpdatedAt: new Date().toISOString(),
            });
        });
      },
    )
  : undefined;
