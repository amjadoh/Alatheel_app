import test from "node:test";
import assert from "node:assert/strict";
import { updateFeedbackIssueStatus } from "../functions/src/feedback-export";
import {
  isFeedbackStatusRequest,
  synchronizeFeedbackStatus,
} from "../functions/src/feedback-sync";
const note = {
  id: "isolated_status_note",
  status: "resolved",
  issueNumber: 123,
  issueUrl: "https://github.com/amjadoh/Alatheel_app/issues/123",
};
function issueFixture() {
  const issue: any = {
    number: 123,
    state: "open",
    state_reason: null,
    body: "<!-- alatheel-feedback:isolated_status_note -->\n\nTest fixture",
  };
  const patches: any[] = [];
  const github = async (path: string, method = "GET", data?: any) => {
    assert.equal(path, "/issues/123");
    if (method === "PATCH") {
      patches.push(data);
      Object.assign(issue, data);
    } else assert.equal(method, "GET");
    return structuredClone(issue);
  };
  return { issue, patches, github };
}
function workerFixture() {
  const state: any = {
    ...note,
    syncState: "synced",
    statusSyncState: "queued",
    statusRequestId: "request_one",
    statusUpdatedAt: new Date().toISOString(),
    statusAttempts: 0,
    emailState: "disabled",
  };
  const ref = {};
  const db: any = {
    collection: () => ({ doc: () => ref }),
    runTransaction: async (fn: any) =>
      fn({
        get: async () => ({ data: () => ({ ...state }) }),
        update: (_: any, patch: any) => Object.assign(state, patch),
      }),
  };
  let calls = 0;
  const run = (updateStatus: any = async () => {}, requestId = "request_one") =>
    synchronizeFeedbackStatus(
      db,
      note.id,
      requestId,
      new Date().toISOString(),
      () => "isolated",
      async (n, g) => {
        calls++;
        await updateStatus(n, g);
      },
    );
  return { state, run, calls: () => calls };
}
test("resolved closes as completed; discussion reopens; repeated updates never create issues/comments or repeat PATCH", async () => {
  const f = issueFixture();
  await updateFeedbackIssueStatus(note, f.github);
  await updateFeedbackIssueStatus(note, f.github);
  assert.deepEqual(f.patches, [{ state: "closed", state_reason: "completed" }]);
  await updateFeedbackIssueStatus({ ...note, status: "discussion" }, f.github);
  await updateFeedbackIssueStatus({ ...note, status: "new" }, f.github);
  assert.deepEqual(f.patches[1], { state: "open", state_reason: "reopened" });
  assert.equal(f.patches.length, 2);
});
test("status update refuses another repository, mismatched marker, or a pull request", async () => {
  const f = issueFixture();
  await assert.rejects(() =>
    updateFeedbackIssueStatus(
      { ...note, issueUrl: "https://github.com/another/repo/issues/123" },
      f.github,
    ),
  );
  f.issue.body = "another issue";
  await assert.rejects(() => updateFeedbackIssueStatus(note, f.github));
  f.issue.body = "<!-- alatheel-feedback:isolated_status_note -->\n";
  f.issue.pull_request = {};
  await assert.rejects(() => updateFeedbackIssueStatus(note, f.github));
  assert.equal(f.patches.length, 0);
});
test("a status request runs on explicit change or after issue export, never its own progress writes", () => {
  const queued = {
    syncState: "synced",
    statusSyncState: "queued",
    statusRequestId: "one",
  };
  assert.equal(isFeedbackStatusRequest({}, queued), true);
  assert.equal(
    isFeedbackStatusRequest(
      { ...queued, statusSyncState: "uploading" },
      queued,
    ),
    false,
  );
  assert.equal(
    isFeedbackStatusRequest({ ...queued, syncState: "uploading" }, queued),
    true,
  );
  assert.equal(
    isFeedbackStatusRequest({}, { ...queued, syncState: "draft" }),
    false,
  );
});
test("worker acknowledges status once and does not re-export attachments or queue email", async () => {
  const f = workerFixture();
  await f.run();
  await f.run();
  assert.equal(f.calls(), 1);
  assert.equal(f.state.statusSyncState, "synced");
  assert.equal(f.state.syncState, "synced");
  assert.equal(f.state.emailState, "disabled");
  assert.equal(f.state.statusAttempts, 1);
});
test("status failures stop after five attempts and expose only a safe retry message", async () => {
  const f = workerFixture(),
    fail = async () => {
      throw Error("private response SECRET");
    };
  for (let i = 0; i < 4; i++)
    await assert.rejects(() => f.run(fail), /temporarily unavailable/);
  await f.run(fail);
  await f.run(fail);
  assert.equal(f.calls(), 5);
  assert.equal(f.state.statusSyncState, "failed");
  assert.ok(!f.state.statusLastFailure.includes("SECRET"));
  assert.equal(f.state.statusLeaseUntil, 0);
});
test("newer status supersedes an in-flight request without losing its pending state or lease", async () => {
  const f = workerFixture();
  await f.run(async () => {
    Object.assign(f.state, {
      statusRequestId: "request_two",
      status: "discussion",
      statusSyncState: "queued",
      statusAttempts: 0,
    });
  });
  assert.equal(f.state.statusSyncState, "queued");
  assert.equal(f.state.statusLeaseUntil, 0);
  await f.run(
    async (n: any) => assert.equal(n.status, "discussion"),
    "request_two",
  );
  assert.equal(f.state.statusSyncState, "synced");
});
test("active status leases retry, stale request IDs do nothing, and expired requests fail without GitHub calls", async () => {
  const f = workerFixture();
  f.state.statusLeaseUntil = Date.now() + 60000;
  await assert.rejects(() => f.run(), /lease active/);
  assert.equal(f.calls(), 0);
  await f.run(undefined, "old_request");
  assert.equal(f.calls(), 0);
  f.state.statusLeaseUntil = 0;
  f.state.statusUpdatedAt = "2020-01-01T00:00:00Z";
  await f.run();
  assert.equal(f.calls(), 0);
  assert.equal(f.state.statusSyncState, "failed");
});
test("lost acknowledgement after closing is recovered without a second PATCH", async () => {
  const f = workerFixture(),
    gh = issueFixture();
  let lose = true;
  const update = async (n: any) =>
    updateFeedbackIssueStatus(n, async (p, m, d) => {
      const result = await gh.github(p, m, d);
      if (m === "PATCH" && lose) {
        lose = false;
        throw Error("lost acknowledgement");
      }
      return result;
    });
  await assert.rejects(() => f.run(update));
  await f.run(update);
  assert.equal(gh.patches.length, 1);
  assert.equal(f.state.statusSyncState, "synced");
  assert.equal(f.state.statusAttempts, 2);
});
test("status queued before issue export waits without spending an attempt", async () => {
  const f = workerFixture();
  f.state.syncState = "queued";
  await f.run();
  assert.equal(f.calls(), 0);
  assert.equal(f.state.statusAttempts, 0);
});
