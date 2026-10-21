import type { State } from "../functions/src/domain";
import { hasPendingFeeding } from "../functions/src/feeding-stock";
import { previousFeedingDay } from "../functions/src/feeding";

export type StartupDataProgress = {
  stage: "session" | "access" | "data" | "maintenance" | "ready";
  completed: number;
  total: number;
};

/** Use only after every watched collection has an authoritative server snapshot.
 * The server remains responsible for freezing periods and all financial writes.
 */
export function requiresStartupMaintenance(state: State, today: string) {
  const month = today.slice(0, 7);
  return !state.financialPeriods.some(period => period.id === month) ||
    state.financialPeriods.some(period => period.id < month && !period.closed) ||
    hasPendingFeeding(state, previousFeedingDay(today));
}

/** A callable response alone does not make the displayed balances current.
 * Wait for all server listeners to reflect the completed maintenance too.
 * synchronize() is called from Firestore's onSnapshotsInSync, after the affected
 * listeners have received a change, so a half-delivered transaction cannot open UI.
 */
export function createStartupDataGate(options: {
  collections: readonly string[];
  needsMaintenance: () => boolean;
  maintain: () => Promise<unknown>;
  active: () => boolean;
  progress: (progress: StartupDataProgress) => void;
  failed: (error: unknown) => void;
  // Injected by isolated tests; production uses a bounded wait with no forced write.
  waitForSnapshots?: (expired: () => void) => (() => void);
}) {
  const server = new Set<string>();
  let inFlight = false, awaitingSnapshot = false, failed = false, disposed = false;
  let cancelWait: (() => void) | undefined;
  const active = () => !disposed && options.active();
  const report = (stage: StartupDataProgress["stage"]) => options.progress({
    stage, completed: server.size, total: options.collections.length,
  });
  const stopWait = () => { cancelWait?.(); cancelWait = undefined; };
  const waitForServer = () => {
    if (cancelWait || failed) return;
    const expired = () => {
      cancelWait = undefined;
      if (!active()) return;
      failed = true; awaitingSnapshot = false;
      report(server.size === options.collections.length ? "maintenance" : "data");
      options.failed(Object.assign(new Error("تعذر تأكيد اكتمال تحديث البيانات. تحقق من اتصالك وصحة تاريخ الجهاز ثم أعد المحاولة"),
        { code: "startup/snapshot-timeout" }));
    };
    cancelWait = options.waitForSnapshots ? options.waitForSnapshots(expired) : (() => {
      const timer = setTimeout(expired, 15000);
      return () => clearTimeout(timer);
    })();
  };
  const synchronize = () => {
    if (!active()) return;
    if (server.size !== options.collections.length) { report("data"); waitForServer(); return; }
    const required = options.needsMaintenance();
    if (inFlight || required && (awaitingSnapshot || failed)) {
      report("maintenance");
      if (awaitingSnapshot) waitForServer();
      return;
    }
    stopWait();
    if (!required) { awaitingSnapshot = false; failed = false; report("ready"); return; }
    inFlight = true;
    report("maintenance");
    void Promise.resolve().then(() => active() ? options.maintain() : undefined).then(() => {
      if (!active()) return;
      inFlight = false;
      awaitingSnapshot = true;
      synchronize();
    }, error => {
      if (!active()) return;
      stopWait();
      inFlight = false;
      failed = true;
      report("maintenance");
      options.failed(error);
    });
  };
  return {
    snapshot(collection: string, fromServer: boolean) {
      if (!active() || !options.collections.includes(collection)) return;
      if (fromServer) server.add(collection); else server.delete(collection);
    },
    synchronize,
    retry() { if (active() && !inFlight) { stopWait(); failed = false; awaitingSnapshot = false; synchronize(); } },
    dispose() { disposed = true; stopWait(); server.clear(); },
  };
}
