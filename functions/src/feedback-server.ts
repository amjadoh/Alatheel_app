import { createHash } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import { onCall, onRequest, HttpsError } from "firebase-functions/v2/https";
import { FEEDBACK_LIMITS as L, FEEDBACK_REPO, feedbackManifest, verifyBridgeToken, githubSigningKey } from "./feedback-policy";
import { businessDay } from "./dates";
const digest = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
const validId = (id: any) => typeof id === "string" && /^[a-zA-Z0-9_-]{6,100}$/.test(id);
function check(value: unknown, message: string): asserts value { if (!value) throw new HttpsError("failed-precondition", message); }
export function feedbackFunctions(db: Firestore, verifiedGoogle: (request: any) => Promise<any>) {
  const notes = db.collection("appFeedback");
  async function fileBytes(id: string, file: any) {
    const chunks = await notes.doc(id).collection("files").doc(String(file.index)).collection("chunks").get();
    check(chunks.size === file.chunks, "رفع المرفق غير مكتمل؛ أعد المحاولة");
    const parts = new Map(chunks.docs.map(d => [d.id, d.data().base64]));
    const bytes = Buffer.concat(Array.from({ length: file.chunks }, (_, i) => Buffer.from(parts.get(String(i)) || "", "base64")));
    check(bytes.length === file.size && digest(bytes) === file.sha256, "المرفق لا يطابق الملف الأصلي؛ أعد رفعه");
    return bytes;
  }
  const appFeedback = onCall({ region: "us-central1", maxInstances: 3, memory: "512MiB", timeoutSeconds: 120 }, async request => {
    await verifiedGoogle(request);
    const user = await db.doc("users/" + request.auth!.uid).get();
    check(user.exists && user.data()?.role === "admin" && user.data()?.membershipApproved === true && !user.data()?.disabled, "ملاحظات التطبيق للمدير فقط");
    const { action, id, ...data } = request.data || {};
    check(validId(id), "معرف الملاحظة غير صحيح");
    const ref = notes.doc(id), now = new Date().toISOString();
    if (action === "create") {
      const manifest = feedbackManifest(data), fingerprint = digest(JSON.stringify(manifest));
      await db.runTransaction(async tx => {
        const old = await tx.get(ref);
        if (old.exists) { check(old.data()?.fingerprint === fingerprint && old.data()?.createdBy === request.auth!.uid, "معرف ملاحظة مستخدم"); return; }
        const usage = db.doc("feedbackUsage/" + request.auth!.uid + "_" + businessDay(now));
        const quota = await tx.get(usage);
        check(Number(quota.data()?.count || 0) < 15, "وصلت إلى حد الملاحظات اليوم؛ تابع الملاحظات السابقة أو حاول غدًا");
        tx.set(usage, { count: Number(quota.data()?.count || 0) + 1 });
        tx.create(ref, { ...manifest, fingerprint, createdBy: request.auth!.uid,
          createdByName: String(user.data()?.displayName || "مدير"), createdAt: now,
          syncState: "draft", status: "new", emailState: "waiting", attempts: 0 });
      });
      return { ok: true, syncState: (await ref.get()).data()?.syncState };
    }
    const snap = await ref.get(); check(snap.exists, "الملاحظة غير موجودة"); const note = snap.data()!;
    if (action === "upload") {
      check(note.createdBy === request.auth!.uid && note.syncState === "draft", "لا يمكن تغيير مرفقات الملاحظة المرسلة");
      const file = note.files?.[data.file];
      check(Number.isSafeInteger(data.file) && file && Number.isSafeInteger(data.chunk) && data.chunk >= 0 && data.chunk < file.chunks, "جزء المرفق غير صحيح");
      check(typeof data.base64 === "string" && /^[A-Za-z0-9+/]*={0,2}$/.test(data.base64) && data.base64.length <= L.chunkBytes * 4 / 3 + 4, "بيانات المرفق غير صحيحة");
      const bytes = Buffer.from(data.base64, "base64"), expected = Math.min(L.chunkBytes, file.size - data.chunk * L.chunkBytes);
      check(bytes.length === expected && bytes.toString("base64") === data.base64, "حجم جزء المرفق غير صحيح");
      const chunkRef = ref.collection("files").doc(String(data.file)).collection("chunks").doc(String(data.chunk));
      await db.runTransaction(async tx => {
        const current = await tx.get(ref), old = await tx.get(chunkRef);
        check(current.data()?.syncState === "draft", "الملاحظة مرسلة ولا تقبل تغيير المرفقات");
        if (old.exists) check(old.data()?.base64 === data.base64, "لا يمكن استبدال مرفق بمعرف رفع سابق");
        else tx.create(chunkRef, { base64: data.base64 });
      });
      return { ok: true };
    }
    if (action === "submit") {
      check(note.createdBy === request.auth!.uid, "لا يمكن إرسال مسودة مدير آخر");
      if (note.syncState !== "draft") return { ok: true, queued: true };
      for (const file of note.files || []) await fileBytes(id, file);
      await db.runTransaction(async tx => {
        const current = await tx.get(ref);
        if (current.data()?.syncState === "draft") tx.update(ref, { syncState: "queued", submittedAt: now });
      });
      return { ok: true, queued: true };
    }
    if (action === "status") {
      check(["new", "discussion", "resolved"].includes(data.status), "حالة الملاحظة غير صحيحة");
      await ref.update({ status: data.status, updatedAt: now, updatedBy: request.auth!.uid });
      return { ok: true };
    }
    if (action === "retry") {
      check(note.syncState === "failed", "الملاحظة لا تحتاج إعادة إرسال");
      await ref.update({ syncState: "queued", attempts: 0, leaseUntil: 0, updatedAt: now });
      return { ok: true };
    }
    if (action === "download") {
      const file = note.files?.[data.file]; check(Number.isSafeInteger(data.file) && file, "المرفق غير موجود");
      return { base64: (await fileBytes(id, file)).toString("base64"), name: file.name, mime: file.mime };
    }
    throw new HttpsError("invalid-argument", "عملية ملاحظة غير معروفة");
  });
  // Only the exact private repository workflow may export notes. No stored GitHub credential.
  const feedbackBridge = onRequest({ region: "us-central1", invoker: "public", maxInstances: 2, memory: "512MiB", timeoutSeconds: 120 }, async (req, res) => {
    res.set("Cache-Control", "no-store");
    if (req.method !== "POST") { res.status(405).end(); return; }
    let worker: string;
    try { worker = await verifyBridgeToken(String(req.headers["x-alatheel-workflow-token"] || req.headers.authorization || "").replace(/^Bearer /, ""), githubSigningKey); }
    catch (error) {
      const safe = new Set(["Invalid issuer or audience","Wrong repository","Wrong repository context","Wrong workflow","Wrong event","Expired or premature token","Invalid run identity","Invalid token","Invalid signing algorithm","Invalid signature","OIDC keys unavailable","Invalid OIDC keys","Unknown signing key"]);
      const reason = error instanceof Error && safe.has(error.message) ? error.message : "Unreadable workflow token";
      console.warn("Feedback workflow authorization rejected", { reason });
      res.status(401).json({ error: "Unauthorized workflow" }); return;
    }
    try {
      const { action, id, file: fileIndex } = req.body || {}, now = Date.now();
      if (action === "claim") {
        const candidates = await notes.where("syncState", "in", ["queued", "uploading"]).limit(30).get();
        for (const candidate of candidates.docs) {
          const claimed = await db.runTransaction(async tx => {
            const latest = await tx.get(candidate.ref), value = latest.data()!;
            if (!["queued", "uploading"].includes(value.syncState) || value.leaseUntil > now) return null;
            if (value.attempts >= 8) { tx.update(candidate.ref, { syncState: "failed", leaseUntil: 0 }); return null; }
            tx.update(candidate.ref, { syncState: "uploading", leaseOwner: worker, leaseUntil: now + 20 * 60 * 1000, attempts: Number(value.attempts || 0) + 1 });
            return { id: candidate.id, text: value.text, files: value.files, version: value.version, createdByName: value.createdByName, createdAt: value.createdAt };
          });
          if (claimed) { res.json({ note: claimed }); return; }
        }
        res.json({ note: null }); return;
      }
      check(validId(id), "Invalid note");
      const ref = notes.doc(id), value = (await ref.get()).data();
      check(value && value.leaseOwner === worker && value.leaseUntil > now && value.syncState === "uploading", "Expired export lease");
      if (action === "file") {
        const file = value.files?.[fileIndex]; check(Number.isSafeInteger(fileIndex) && file, "Invalid file");
        res.json({ base64: (await fileBytes(id, file)).toString("base64"), sha256: file.sha256 }); return;
      }
      if (action === "complete") {
        check(Number.isSafeInteger(req.body.number) && req.body.number > 0 && req.body.url === "https://github.com/" + FEEDBACK_REPO + "/issues/" + req.body.number, "Invalid issue result");
        await ref.update({ syncState: "synced", issueNumber: req.body.number, issueUrl: req.body.url, syncedAt: new Date().toISOString(), emailState: "queued", leaseUntil: 0 });
        res.json({ ok: true }); return;
      }
      if (action === "failed") {
        await ref.update({ syncState: value.attempts >= 8 ? "failed" : "queued", leaseUntil: now + 5 * 60 * 1000, lastFailure: "تعذرت المزامنة مع المستودع؛ ستتم إعادة المحاولة تلقائيًا" });
        res.json({ ok: true }); return;
      }
      res.status(400).json({ error: "Unknown action" });
    } catch { res.status(409).json({ error: "Feedback request failed" }); }
  });
  return { appFeedback, feedbackBridge };
}
