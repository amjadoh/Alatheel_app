import { randomUUID } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import { defineSecret } from "firebase-functions/params";
import {
  exportFeedback,
  githubClient,
  updateFeedbackIssueStatus,
} from "./feedback-export";
import { FEEDBACK_REPO } from "./feedback-policy";

export const feedbackGithubToken = defineSecret("FEEDBACK_GITHUB_TOKEN");
export const MAX_FEEDBACK_ATTEMPTS = 5;
export function isFeedbackSubmission(before: any, after: any) {
  return (
    after?.syncState === "queued" &&
    typeof after.syncRequestId === "string" &&
    after.syncRequestId !== before?.syncRequestId
  );
}
export function isFeedbackStatusRequest(before: any, after: any) {
  return (
    after?.syncState === "synced" &&
    after.statusSyncState === "queued" &&
    typeof after.statusRequestId === "string" &&
    (after.statusRequestId !== before?.statusRequestId ||
      before?.syncState !== "synced")
  );
}
export async function synchronizeFeedbackStatus(
  db: Firestore,
  id: string,
  requestId: string,
  eventTime: string,
  token: () => string,
  updateStatus = updateFeedbackIssueStatus,
) {
  const ref = db.collection("appFeedback").doc(id),
    owner = randomUUID(),
    now = Date.now();
  const note = await db.runTransaction(async (tx) => {
    const value = (await tx.get(ref)).data();
    if (
      !value ||
      value.statusRequestId !== requestId ||
      value.syncState !== "synced" ||
      !["queued", "uploading"].includes(value.statusSyncState)
    )
      return null;
    if (value.statusLeaseUntil > now)
      throw new Error("Feedback status lease active");
    if (
      (value.statusAttempts || 0) >= MAX_FEEDBACK_ATTEMPTS ||
      now - Date.parse(value.statusUpdatedAt || eventTime) > 24 * 60 * 60 * 1000
    ) {
      tx.update(ref, {
        statusSyncState: "failed",
        statusLeaseUntil: 0,
        statusLastFailure: "تعذر تحديث حالة GitHub؛ أعد مزامنة الحالة",
      });
      return null;
    }
    tx.update(ref, {
      statusSyncState: "uploading",
      statusLeaseOwner: owner,
      statusLeaseUntil: now + 10 * 60 * 1000,
      statusAttempts: Number(value.statusAttempts || 0) + 1,
    });
    return { ...value, id, attempts: Number(value.statusAttempts || 0) + 1 };
  });
  if (!note) return;
  try {
    await updateStatus(note, githubClient(token()));
    await db.runTransaction(async (tx) => {
      const value = (await tx.get(ref)).data();
      if (value?.statusLeaseOwner !== owner) return;
      if (value.statusRequestId !== requestId) {
        tx.update(ref, { statusLeaseUntil: 0 });
        return;
      }
      tx.update(ref, {
        statusSyncState: "synced",
        statusLeaseUntil: 0,
        statusLastFailure: "",
        statusSyncedAt: new Date().toISOString(),
      });
    });
  } catch {
    const retry = await db.runTransaction(async (tx) => {
      const value = (await tx.get(ref)).data();
      if (value?.statusLeaseOwner !== owner) return false;
      if (value.statusRequestId !== requestId) {
        tx.update(ref, { statusLeaseUntil: 0 });
        return false;
      }
      const retry = note.attempts < MAX_FEEDBACK_ATTEMPTS;
      tx.update(ref, {
        statusSyncState: retry ? "queued" : "failed",
        statusLeaseUntil: 0,
        statusLastFailure: retry
          ? "تعذر تحديث حالة GitHub؛ ستعاد المحاولة تلقائيًا"
          : "تعذر تحديث حالة GitHub؛ أعد مزامنة الحالة",
      });
      return retry;
    });
    if (retry)
      throw new Error(
        "Feedback status synchronization temporarily unavailable",
      );
  }
}
export async function synchronizeFeedback(
  db: Firestore,
  id: string,
  requestId: string,
  eventTime: string,
  token: () => string,
  readFile: (id: string, file: any) => Promise<Buffer>,
  exportNote = exportFeedback,
) {
  const ref = db.collection("appFeedback").doc(id),
    owner = randomUUID(),
    now = Date.now();
  const note = await db.runTransaction(async (tx) => {
    const value = (await tx.get(ref)).data();
    if (
      !value ||
      value.syncRequestId !== requestId ||
      !["queued", "uploading"].includes(value.syncState)
    )
      return null;
    // Never acknowledge a duplicate event while another invocation could still fail.
    if (value.leaseUntil > now) throw new Error("Feedback export lease active");
    if (
      (value.attempts || 0) >= MAX_FEEDBACK_ATTEMPTS ||
      now - Date.parse(eventTime) > 24 * 60 * 60 * 1000
    ) {
      tx.update(ref, {
        syncState: "failed",
        leaseUntil: 0,
        lastFailure: "تعذرت المزامنة؛ يمكنك إعادة المحاولة من التطبيق",
      });
      return null;
    }
    tx.update(ref, {
      syncState: "uploading",
      leaseOwner: owner,
      leaseUntil: now + 10 * 60 * 1000,
      attempts: Number(value.attempts || 0) + 1,
    });
    return { ...value, id, attempts: Number(value.attempts || 0) + 1 };
  });
  if (!note) return;
  try {
    const issue = await exportNote(note, githubClient(token()), (file) =>
      readFile(id, file),
    );
    if (
      !Number.isSafeInteger(issue.number) ||
      issue.number < 1 ||
      issue.html_url !==
        `https://github.com/${FEEDBACK_REPO}/issues/${issue.number}`
    )
      throw new Error("Invalid issue result");
    await db.runTransaction(async (tx) => {
      const current = (await tx.get(ref)).data();
      if (current?.leaseOwner !== owner || current.syncRequestId !== requestId)
        throw new Error("Export lease changed");
      tx.update(ref, {
        syncState: "synced",
        issueNumber: issue.number,
        issueUrl: issue.html_url,
        ...(!current.statusRequestId &&
        ["new", "discussion", "resolved"].includes(current.status)
          ? {
              statusRequestId: randomUUID(),
              statusUpdatedAt: new Date().toISOString(),
              statusSyncState: "queued",
              statusAttempts: 0,
              statusLastFailure: "",
            }
          : {}),
        syncedAt: new Date().toISOString(),
        emailState: "disabled",
        leaseUntil: 0,
        lastFailure: "",
      });
    });
  } catch {
    const retry = await db.runTransaction(async (tx) => {
      const current = (await tx.get(ref)).data();
      if (
        current?.leaseOwner !== owner ||
        current.syncRequestId !== requestId ||
        current.syncState === "synced"
      )
        return false;
      const retry = note.attempts < MAX_FEEDBACK_ATTEMPTS;
      tx.update(ref, {
        syncState: retry ? "queued" : "failed",
        leaseUntil: 0,
        lastFailure: retry
          ? "تعذرت المزامنة؛ ستتم إعادة المحاولة تلقائيًا"
          : "تعذرت المزامنة؛ يمكنك إعادة المحاولة من التطبيق",
      });
      return retry;
    });
    // Eventarc retries the original submission; our own status writes don't start exports.
    // Never log note contents, response bodies, attachments or credentials.
    if (retry)
      throw new Error("Feedback synchronization temporarily unavailable");
  }
}
export function feedbackSyncFunction(
  db: Firestore,
  database: string,
  readFile: (id: string, file: any) => Promise<Buffer>,
) {
  return onDocumentUpdated(
    {
      region: "us-central1",
      database,
      document: "appFeedback/{feedbackId}",
      secrets: [feedbackGithubToken],
      retry: true,
      minInstances: 0,
      maxInstances: 1,
      concurrency: 1,
      memory: "512MiB",
      timeoutSeconds: 540,
    },
    async (event) => {
      const before = event.data?.before.data(),
        after = event.data?.after.data();
      if (isFeedbackSubmission(before, after))
        await synchronizeFeedback(
          db,
          event.params.feedbackId,
          after!.syncRequestId,
          event.time,
          () => feedbackGithubToken.value(),
          readFile,
        );
      if (isFeedbackStatusRequest(before, after))
        await synchronizeFeedbackStatus(
          db,
          event.params.feedbackId,
          after!.statusRequestId,
          event.time,
          () => feedbackGithubToken.value(),
        );
    },
  );
}
