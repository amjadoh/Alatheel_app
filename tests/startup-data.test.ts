import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCommand, emptyState, type State } from "../functions/src/domain";
import { financialSummary } from "../functions/src/finance";
import { businessDay } from "../functions/src/dates";
import { createStartupDataGate, requiresStartupMaintenance, type StartupDataProgress } from "../src/startup-data";

const admin = { uid: "admin", role: "admin" as const, displayName: "المدير" };
const now = "2026-10-21T09:00:00.000Z", day = businessDay(now);
function prepared(): State {
  return applyCommand(emptyState(), admin, { action: "finance.rollover", requestId: "prepare_period" }, now);
}
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
function deferred() {
  let resolve!: () => void, reject!: (error: unknown) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function harness(required = false) {
  let active = true, calls = 0;
  let timeout: (() => void) | undefined;
  const pending = deferred(), progress: StartupDataProgress[] = [], failures: unknown[] = [];
  const gate = createStartupDataGate({
    collections: ["profile", "horses", "financialPeriods"],
    needsMaintenance: () => required,
    maintain: () => { calls++; return pending.promise; },
    active: () => active,
    progress: value => progress.push(value),
    failed: error => failures.push(error),
    waitForSnapshots: expired => { timeout = expired; return () => { timeout = undefined; }; },
  });
  const server = () => {
    for (const name of ["profile", "horses", "financialPeriods"]) gate.snapshot(name, true);
    gate.synchronize();
  };
  return { gate, pending, progress, failures, server,
    calls: () => calls, needs: (value: boolean) => { required = value; },
    expireWait: () => timeout?.(),
    deactivate: () => { active = false; }, stage: () => progress.at(-1)?.stage };
}

test("an already prepared month opens without a financial write and leaves totals unchanged", () => {
  const s = prepared(), before = structuredClone(s), summary = financialSummary(s, "2026-10");
  assert.equal(requiresStartupMaintenance(s, day), false);
  assert.deepEqual(s, before);
  assert.deepEqual(financialSummary(s, "2026-10"), summary);
});

test("missing current month and old open months still require the original server rollover", () => {
  const s = applyCommand(emptyState(), admin, { action: "finance.rollover", requestId: "previous_period" }, "2026-09-20T09:00:00.000Z");
  const previous = financialSummary(s, "2026-09");
  assert.equal(requiresStartupMaintenance(s, day), true);
  const next = applyCommand(s, admin, { action: "finance.rollover", requestId: "close_previous" }, now);
  assert.equal(requiresStartupMaintenance(next, day), false);
  assert.deepEqual(financialSummary(next, "2026-09"), previous);
  const malformed = prepared();
  malformed.financialPeriods.push({ ...s.financialPeriods[0] });
  assert.equal(requiresStartupMaintenance(malformed, day), true);
});

test("feeding is required only through yesterday in Riyadh and does not count a future activation", () => {
  const s = prepared();
  s.mealTypes = [{ id: "feed", autoFeedingFrom: "2026-10-01", autoFeedingThrough: "2026-10-20" }];
  assert.equal(requiresStartupMaintenance(s, day), false);
  s.mealTypes[0].autoFeedingThrough = "2026-10-19";
  assert.equal(requiresStartupMaintenance(s, day), true);
  s.mealTypes[0] = { id: "feed", autoFeedingFrom: "2026-10-21" };
  assert.equal(requiresStartupMaintenance(s, day), false);
  assert.equal(businessDay("2026-10-20T21:01:00Z"), day);
});

test("daily catch-up uses normal feeding ledger once without inventing a second purchase or payment", () => {
  const s = prepared();
  s.mealTypes = [{ id: "hay", name: "رودس", unit: "ربطة", pricePerUnit: 20,
    currentStock: 10, minThreshold: 1, autoFeedingFrom: "2026-10-20" }];
  s.horses = [{ id: "horse", name: "خيل", status: "private", entryDate: "2026-10-01",
    feeding: [{ mealTypeId: "hay", quantity: .2, frequency: "daily" }] }];
  assert.equal(requiresStartupMaintenance(s, day), true);
  const next = applyCommand(s, admin, { action: "finance.rollover", requestId: "feeding_catchup" }, now);
  assert.equal(requiresStartupMaintenance(next, day), false);
  assert.equal(next.mealTypes[0].currentStock, 9.8);
  assert.equal(next.inventoryTransactions.length, 1);
  assert.equal(next.expenses.length, 0);
  assert.equal(next.expensePayments.length, 0);
  assert.equal(financialSummary(next, "2026-10").paid, financialSummary(s, "2026-10").paid);
});

test("cache and incomplete collections never enable balances or invoke maintenance", async () => {
  const h = harness(true);
  h.gate.snapshot("profile", true); h.gate.snapshot("horses", true);
  h.gate.snapshot("financialPeriods", false); h.gate.synchronize();
  await flush();
  assert.equal(h.stage(), "data");
  assert.equal(h.calls(), 0);
  h.gate.snapshot("unwatched", true); h.gate.synchronize();
  assert.equal(h.progress.at(-1)?.completed, 2);
});

test("healthy startup completes immediately after parallel server snapshots, with no rollover delay", async () => {
  const h = harness(false);
  h.server();
  assert.equal(h.stage(), "ready");
  await flush();
  assert.equal(h.calls(), 0);
  assert.equal(h.progress.at(-1)?.completed, 3);
});

test("callable success cannot expose old balances before its server snapshots arrive", async () => {
  const h = harness(true);
  h.server(); h.gate.synchronize(); h.gate.synchronize();
  await flush();
  assert.equal(h.calls(), 1);
  h.pending.resolve(); await flush();
  assert.equal(h.stage(), "maintenance");
  h.gate.synchronize(); await flush();
  assert.equal(h.calls(), 1);
  h.needs(false); h.gate.synchronize();
  assert.equal(h.stage(), "ready");
});

test("server snapshots before callable completion still wait for authoritative operation success", async () => {
  const h = harness(true); h.server(); await flush();
  h.needs(false); h.gate.synchronize();
  assert.equal(h.stage(), "maintenance");
  h.pending.resolve(); await flush();
  assert.equal(h.stage(), "ready");
});

test("failed catch-up stays blocked, reports an error, and does not spin on realtime callbacks", async () => {
  const h = harness(true); h.server(); await flush();
  const error = new Error("temporary network failure");
  h.pending.reject(error); await flush();
  assert.equal(h.stage(), "maintenance");
  assert.deepEqual(h.failures, [error]);
  for (let i = 0; i < 10; i++) h.gate.synchronize();
  await flush(); assert.equal(h.calls(), 1);
  // The regular server scheduler may complete catch-up even after a failed response.
  h.needs(false); h.gate.synchronize();
  assert.equal(h.stage(), "ready");
});

test("changing account or disposing prevents stale commands and late completion publishing", async () => {
  const beforeDispatch = harness(true); beforeDispatch.server(); beforeDispatch.deactivate();
  await flush(); assert.equal(beforeDispatch.calls(), 0);
  const inFlight = harness(true); inFlight.server(); await flush();
  inFlight.gate.dispose(); const count = inFlight.progress.length;
  inFlight.needs(false); inFlight.pending.resolve(); await flush();
  inFlight.server();
  assert.equal(inFlight.progress.length, count);
});

test("loss of authoritative profile status blocks an already ready session's data", () => {
  const h = harness(false); h.server(); assert.equal(h.stage(), "ready");
  h.gate.snapshot("profile", false); h.gate.synchronize();
  assert.equal(h.stage(), "data");
  h.gate.snapshot("profile", true); h.gate.synchronize();
  assert.equal(h.stage(), "ready");
});

test("missing server data reports a bounded retryable wait without issuing a financial write", async () => {
  const h = harness(true);
  h.gate.snapshot("profile", true); h.gate.synchronize(); h.expireWait(); await flush();
  assert.equal((h.failures[0] as { code: string }).code, "startup/snapshot-timeout");
  assert.equal(h.calls(), 0); assert.equal(h.stage(), "data");
  h.gate.dispose();
});

test("successful rollover with a mismatched device date cannot wait forever or repeatedly write", async () => {
  const h = harness(true); h.server(); await flush(); h.pending.resolve(); await flush();
  assert.equal(h.stage(), "maintenance"); h.expireWait(); await flush();
  assert.equal((h.failures[0] as { code: string }).code, "startup/snapshot-timeout");
  h.gate.synchronize(); h.gate.synchronize(); await flush();
  assert.equal(h.calls(), 1); assert.equal(h.stage(), "maintenance");
  h.needs(false); h.gate.synchronize(); assert.equal(h.stage(), "ready"); h.gate.dispose();
});
