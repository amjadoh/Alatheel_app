import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  ReactNode,
} from "react";
import {
  Capacitor,
  registerPlugin,
  PluginListenerHandle,
} from "@capacitor/core";
import { App as NativeApp } from "@capacitor/app";
import { Download, RefreshCw } from "lucide-react";
import { RELEASE_VERSION } from "./release-notes";
import {
  normalizeUpdateChannel,
  retainRequiredUpdate,
  shouldCheckUpdate,
  UpdateChannel,
  UpdateCheckReason,
} from "./update-check-policy";

type Release = {
  available: boolean;
  versionName: string;
  notes: string;
  ready: boolean;
};
export interface UpdaterPlugin {
  check(options: { channel: UpdateChannel }): Promise<Release>;
  download(): Promise<void>;
  install(): Promise<{ permissionRequired: boolean }>;
  addListener(
    event: "progress",
    callback: (p: { percent: number }) => void,
  ): Promise<PluginListenerHandle>;
}
const Updater = registerPlugin<UpdaterPlugin>("AppUpdater");
const isAndroid = Capacitor.getPlatform() === "android";
const CHANNEL_KEY = "alatheel.update.channel";
const UpdateContext = createContext({
  check: () => {},
  busy: false,
  message: "",
  checking: false,
  verified: true,
  blocked: false,
  channel: "stable" as UpdateChannel,
  selectChannel: (_: UpdateChannel) => {},
});
export const useAppUpdate = () => useContext(UpdateContext);

export function UpdateButton() {
  const { check, busy, message } = useContext(UpdateContext);
  if (!isAndroid) return null;
  return (
    <section className="card update-card">
      <h3>تحديث التطبيق</h3>
      <p className="muted small">
        الإصدار {RELEASE_VERSION} · يجري التحقق عند فتح التطبيق
      </p>
      <UpdateChannelControl />
      <button className="button outline" disabled={busy} onClick={check}>
        <RefreshCw size={18} /> التحقق من التحديث
      </button>
      {message && <p role="status">{message}</p>}
    </section>
  );
}

function UpdateChannelControl({ disabled = false }: { disabled?: boolean }) {
  const { channel, selectChannel } = useContext(UpdateContext);
  return (
    <div className="update-channel" role="group" aria-label="قناة التحديث">
      <button
        type="button"
        className={channel === "stable" ? "selected" : ""}
        aria-pressed={channel === "stable"}
        disabled={disabled}
        onClick={() => selectChannel("stable")}
      >
        Official
      </button>
      <button
        type="button"
        className={channel === "beta" ? "selected" : ""}
        aria-pressed={channel === "beta"}
        disabled={disabled}
        onClick={() => selectChannel("beta")}
      >
        Bata
      </button>
    </div>
  );
}

export function UpdateGate({
  children,
  client = Updater,
  android = isAndroid,
}: {
  children: ReactNode;
  client?: UpdaterPlugin;
  android?: boolean;
}) {
  const [checking, setChecking] = useState(android);
  const [verified, setVerified] = useState(!android);
  const [release, setRelease] = useState<Release | null>(null);
  const [failedCheck, setFailedCheck] = useState(false);
  const [working, setWorking] = useState(false);
  const [percent, setPercent] = useState(0);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [instruction, setInstruction] = useState("");
  const [channel, setChannel] = useState<UpdateChannel>(() =>
    normalizeUpdateChannel(localStorage.getItem(CHANNEL_KEY)),
  );
  const locked = useRef(false);
  const mounted = useRef(true);
  const lastSuccessAt = useRef<number | null>(null);
  const previousCheckFailed = useRef(false);
  const knownRelease = useRef<Release | null>(null);
  const channelRef = useRef(channel);
  const pendingForcedCheck = useRef<UpdateChannel | null>(null);
  const check = async (
    reason: UpdateCheckReason = "startup",
    requestedChannel = channelRef.current,
  ) => {
    if (!android) return;
    if (locked.current) {
      // An update notification can arrive while a check/download is running.
      // Coalesce these requests and verify once the current operation finishes.
      if (reason === "manual") pendingForcedCheck.current = requestedChannel;
      return;
    }
    if (
      !shouldCheckUpdate(
        reason,
        lastSuccessAt.current,
        Date.now(),
        previousCheckFailed.current,
      )
    )
      return;
    locked.current = true;
    setChecking(true);
    setError("");
    setMessage("");
    try {
      const incoming = await client.check({ channel: requestedChannel });
      if (!mounted.current || requestedChannel !== channelRef.current) return;
      const result = retainRequiredUpdate(knownRelease.current, incoming);
      knownRelease.current = result;
      lastSuccessAt.current = Date.now();
      previousCheckFailed.current = false;
      setRelease(result);
      setFailedCheck(false);
      setVerified(true);
      if (reason === "manual" && !result.available)
        setMessage("تستخدم أحدث إصدار من التطبيق");
    } catch (e) {
      if (mounted.current && requestedChannel === channelRef.current) {
        previousCheckFailed.current = true;
        setFailedCheck(true);
        setError((e as Error).message || "تعذر التحقق من التحديث");
      }
    } finally {
      locked.current = false;
      if (mounted.current) setChecking(false);
      if (mounted.current && pendingForcedCheck.current) {
        const pendingChannel = pendingForcedCheck.current;
        pendingForcedCheck.current = null;
        void check("manual", pendingChannel);
      }
    }
  };
  useEffect(() => {
    mounted.current = true;
    if (!android) return;
    void check();
    const progress = client.addListener("progress", ({ percent }) => {
      if (mounted.current) setPercent(percent);
    });
    const resume = NativeApp.addListener("appStateChange", ({ isActive }) => {
      if (isActive) void check("resume");
    });
    return () => {
      mounted.current = false;
      void progress.then((h) => h.remove());
      void resume.then((h) => h.remove());
    };
  }, []);
  const selectChannel = (next: UpdateChannel) => {
    if (next === channelRef.current) return;
    channelRef.current = next;
    localStorage.setItem(CHANNEL_KEY, next);
    setChannel(next);
    knownRelease.current = null;
    setRelease(null);
    setFailedCheck(false);
    lastSuccessAt.current = null;
    previousCheckFailed.current = false;
    setError("");
    setMessage("");
    setInstruction("");
    void check("manual", next);
  };
  const update = async () => {
    if (locked.current || !release?.available) return;
    locked.current = true;
    setWorking(true);
    setError("");
    try {
      if (!release.ready) {
        setPercent(0);
        await client.download();
        knownRelease.current = { ...release, ready: true };
        setRelease(knownRelease.current);
      }
      const result = await client.install();
      setInstruction(
        result.permissionRequired
          ? "فعّل «السماح من هذا المصدر» للأثيل، ثم ارجع واضغط «تثبيت التحديث»."
          : "اختر «تحديث» في شاشة أندرويد. إذا أغلقتها، اضغط «تثبيت التحديث» مجددًا.",
      );
    } catch (e) {
      setError((e as Error).message || "تعذر تحديث التطبيق. أعد المحاولة.");
      knownRelease.current = { ...release, ready: false };
      setRelease(knownRelease.current);
    } finally {
      locked.current = false;
      setWorking(false);
      if (mounted.current && pendingForcedCheck.current) {
        const pendingChannel = pendingForcedCheck.current;
        pendingForcedCheck.current = null;
        void check("manual", pendingChannel);
      }
    }
  };
  const panelBlocked = android && (failedCheck || !!release?.available);
  const blocked = android && (checking || panelBlocked);
  return (
    <UpdateContext.Provider
      value={{
        check: () => void check("manual"),
        busy: checking || working,
        message,
        checking,
        verified,
        blocked,
        channel,
        selectChannel,
      }}
    >
      <div hidden={panelBlocked} inert={panelBlocked ? true : undefined}>
        {children}
      </div>
      {panelBlocked && (
        <div className="update-screen" dir="rtl" role="main">
          <section className="card update-panel" aria-labelledby="update-title">
            <img src="/logo.jpeg" alt="شعار الأثيل" className="update-logo" />
            <p className="eyebrow">الأثيل · تحديث التطبيق</p>
            <UpdateChannelControl disabled={working} />
            <h1 id="update-title">
              {checking
                ? "جارٍ التحقق من الإصدار"
                : release?.available
                  ? "حدّث التطبيق للمتابعة"
                  : "تعذر التحقق من الإصدار"}
            </h1>
            {release?.available && (
              <>
                <span className="pill">الإصدار {release.versionName}</span>
                <p className="update-notes">{release.notes}</p>
                <p className="muted">
                  يلزم تثبيت الإصدار الجديد قبل استخدام التطبيق. بيانات الإسطبل
                  والحسابات محفوظة.
                </p>
              </>
            )}
            {working && (
              <div role="status">
                <p>جارٍ تجهيز التحديث · {percent}%</p>
                <progress max={100} value={percent} />
              </div>
            )}
            {error && (
              <p className="update-error" role="alert">
                {error}
              </p>
            )}
            {instruction && <p role="status">{instruction}</p>}
            {!checking && !working && (
              <>
                {failedCheck ? (
                  <button
                    className="button gold"
                    onClick={() => void check("manual")}
                  >
                    <RefreshCw size={18} /> إعادة المحاولة
                  </button>
                ) : (
                  <button className="button gold" onClick={() => void update()}>
                    <Download size={18} />{" "}
                    {release?.ready ? "تثبيت التحديث" : "تنزيل التحديث وتثبيته"}
                  </button>
                )}
                {release?.available && !failedCheck && (
                  <p className="small muted">
                    قد يطلب أندرويد السماح للأثيل بتثبيت التحديث أول مرة، ثم
                    تأكيد التثبيت.
                  </p>
                )}
              </>
            )}
          </section>
        </div>
      )}
    </UpdateContext.Provider>
  );
}
