import test from "node:test";
import assert from "node:assert/strict";
import { isFeedbackSubmission, synchronizeFeedback } from "../functions/src/feedback-sync";

function fixture() {
  const state: any = { syncState: "queued", syncRequestId: "request_one", attempts: 0 };
  const ref = {};
  const db: any = { collection: () => ({ doc: () => ref }), runTransaction: async (fn: any) => fn({
    get: async () => ({ data: () => ({ ...state }) }), update: (_: any, patch: any) => Object.assign(state, patch),
  }) };
  let exports = 0;
  const run = (fail = false, requestId = "request_one", time = new Date().toISOString()) => synchronizeFeedback(
    db, "isolated_note", requestId, time, () => "test-only", async () => Buffer.alloc(0), async () => {
      exports++; if (fail) throw new Error("private response never logged");
      return { number: 1, html_url: "https://github.com/amjadoh/Alatheel_app/issues/1" };
    });
  return { state, run, count: () => exports };
}
test("only a submission or explicit retry starts work, not progress writes", () => {
  assert.equal(isFeedbackSubmission({ syncState: "draft" }, { syncState: "queued", syncRequestId: "one" }), true);
  assert.equal(isFeedbackSubmission({ syncState: "uploading", syncRequestId: "one" }, { syncState: "queued", syncRequestId: "one" }), false);
  assert.equal(isFeedbackSubmission({ syncState: "failed", syncRequestId: "one" }, { syncState: "queued", syncRequestId: "two" }), true);
  assert.equal(isFeedbackSubmission({}, { syncState: "queued" }), false);
});
test("successful delivery is idempotent and does not queue email", async () => {
  const f = fixture(); await f.run(); await f.run();
  assert.equal(f.count(), 1); assert.equal(f.state.syncState, "synced");
  assert.equal(f.state.emailState, "disabled"); assert.equal(f.state.issueNumber, 1);
});
test("failure stops after five attempts and is visible to the user", async () => {
  const f = fixture();
  for (let i = 0; i < 4; i++) await assert.rejects(f.run(true), /temporarily unavailable/);
  await f.run(true); await f.run(true);
  assert.equal(f.count(), 5); assert.equal(f.state.syncState, "failed");
  assert.equal(f.state.leaseUntil, 0); assert.ok(f.state.lastFailure);
});
test("a live lease is retried and an expired lease can recover", async () => {
  const f = fixture(); f.state.syncState = "uploading"; f.state.leaseUntil = Date.now() + 60000;
  await assert.rejects(f.run(), /lease active/); assert.equal(f.count(), 0);
  f.state.leaseUntil = Date.now() - 1; await f.run(); assert.equal(f.count(), 1);
});
test("old submission events cannot change a newer retry", async () => {
  const f = fixture(); f.state.syncRequestId = "new_request";
  await f.run(); assert.equal(f.count(), 0); assert.equal(f.state.syncState, "queued");
});
test("expired event is marked failed without external calls", async () => {
  const f = fixture(); await f.run(false, "request_one", "2020-01-01T00:00:00Z");
  assert.equal(f.count(), 0); assert.equal(f.state.syncState, "failed");
});
