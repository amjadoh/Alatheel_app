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
import { Download, RefreshCw } from "lucide-react";
import { RELEASE_VERSION } from "./release-notes";
import { retainRequiredUpdate } from "./update-check-policy";
import {
  DEFAULT_UPDATE_CHANNEL,
  readUpdateChannel,
  UpdateChannel,
  updateChannelForAccess,
  writeUpdateChannel,
} from "./update-channel";

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
type UpdateContextValue = {
  enabled: boolean;
  check: () => void;
  busy: boolean;
  message: string;
  checking: boolean;
  verified: boolean;
  blocked: boolean;
  channel: UpdateChannel;
  canChooseChannel: boolean;
  setChannel: (channel: UpdateChannel) => void;
  setPrimaryAccess: (primaryAdmin: boolean) => void;
};
const UpdateContext = createContext<UpdateContextValue>({
  enabled: isAndroid,
  check: () => {},
  busy: false,
  message: "",
  checking: false,
  verified: true,
  blocked: false,
  channel: DEFAULT_UPDATE_CHANNEL,
  canChooseChannel: false,
  setChannel: () => {},
  setPrimaryAccess: () => {},
});
export const useAppUpdate = () => useContext(UpdateContext);

export function UpdateButton() {
  const {
    enabled,
    check,
    busy,
    message,
    channel,
    canChooseChannel,
    setChannel,
  } = useContext(UpdateContext);
  if (!enabled) return null;
  return (
    <section className="card update-card">
      <h3>تحديث التطبيق</h3>
      <p className="muted small">
        الإصدار {RELEASE_VERSION} · يجري التحقق عند الطلب
      </p>
      <fieldset className="update-channel" disabled={busy}>
        <legend>قناة التحديث</legend>
        <div
          className={`update-channel-options${canChooseChannel ? "" : " single"}`}
        >
          <button
            type="button"
            className={`update-channel-option${channel === "stable" ? " selected" : ""}`}
            aria-pressed={channel === "stable"}
            onClick={() => setChannel("stable")}
          >
            Official
          </button>
          {canChooseChannel && (
            <button
              type="button"
              className={`update-channel-option${channel === "beta" ? " selected" : ""}`}
              aria-pressed={channel === "beta"}
              onClick={() => setChannel("beta")}
            >
              Bata
            </button>
          )}
        </div>
        <p className="muted small">
          {channel === "beta"
            ? "إصدار مبكر للاختبار وقد يتضمن تغييرات غير نهائية"
            : "الإصدار الرسمي المعتمد للاستخدام اليومي"}
        </p>
      </fieldset>
      <button className="button outline" disabled={busy} onClick={check}>
        <RefreshCw size={18} /> التحقق من التحديث
      </button>
      {message && <p role="status">{message}</p>}
    </section>
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
  const [checking, setChecking] = useState(false);
  const [verified, setVerified] = useState(true);
  const [channel, setChannelState] = useState<UpdateChannel>(
    DEFAULT_UPDATE_CHANNEL,
  );
  const [canChooseChannel, setCanChooseChannel] = useState(false);
  const canChooseChannelRef = useRef(false);
  const [release, setRelease] = useState<Release | null>(null);
  const [failedCheck, setFailedCheck] = useState(false);
  const [working, setWorking] = useState(false);
  const [percent, setPercent] = useState(0);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [instruction, setInstruction] = useState("");
  const locked = useRef(false);
  const mounted = useRef(true);
  const knownRelease = useRef<Release | null>(null);
  const pendingForcedCheck = useRef(false);
  const pendingChannel = useRef<UpdateChannel | null>(null);
  const channelRef = useRef(channel);
  const check = async (
    requestedChannel: UpdateChannel = channelRef.current,
  ) => {
    if (!android) return;
    if (locked.current) {
      // An update notification can arrive while a check/download is running.
      // Coalesce these requests and verify once the current operation finishes.
      pendingForcedCheck.current = true;
      return;
    }
    locked.current = true;
    setChecking(true);
    setError("");
    setMessage("");
    try {
      const incoming = await client.check({ channel: requestedChannel });
      if (!mounted.current || requestedChannel !== channelRef.current) return;
      const result = retainRequiredUpdate(knownRelease.current, incoming);
      knownRelease.current = result;
      setRelease(result);
      setFailedCheck(false);
      setVerified(true);
      if (!result.available)
        setMessage("تستخدم أحدث إصدار من التطبيق");
    } catch (e) {
      if (mounted.current && requestedChannel === channelRef.current) {
        setFailedCheck(true);
        setError((e as Error).message || "تعذر التحقق من التحديث");
      }
    } finally {
      locked.current = false;
      if (mounted.current) setChecking(false);
      if (mounted.current && pendingChannel.current) {
        const next = pendingChannel.current;
        pendingChannel.current = null;
        setChannel(next);
      } else if (mounted.current && pendingForcedCheck.current) {
        pendingForcedCheck.current = false;
        void check();
      }
    }
  };
  const setChannel = (
    next: UpdateChannel,
    persist = canChooseChannelRef.current,
    verify = true,
  ) => {
    next = updateChannelForAccess(canChooseChannelRef.current, next);
    if (locked.current) {
      pendingChannel.current = next;
      return;
    }
    if (next === channelRef.current) return;
    channelRef.current = next;
    setChannelState(next);
    if (persist)
      writeUpdateChannel(
        typeof localStorage === "undefined" ? null : localStorage,
        next,
      );
    knownRelease.current = null;
    setRelease(null);
    setFailedCheck(false);
    setVerified(!verify);
    setMessage("");
    setInstruction("");
    if (verify) void check(next);
  };
  const setPrimaryAccess = (primaryAdmin: boolean) => {
    canChooseChannelRef.current = primaryAdmin;
    setCanChooseChannel(primaryAdmin);
    const stored = readUpdateChannel(
      typeof localStorage === "undefined" ? null : localStorage,
    );
    const next = updateChannelForAccess(primaryAdmin, stored);
    if (next === channelRef.current) {
      pendingChannel.current = null;
      return;
    }
    if (locked.current) {
      pendingChannel.current = next;
      return;
    }
    setChannel(next, primaryAdmin, false);
  };
  useEffect(() => {
    mounted.current = true;
    if (!android) return;
    const progress = client.addListener("progress", ({ percent }) => {
      if (mounted.current) setPercent(percent);
    });
    return () => {
      mounted.current = false;
      void progress.then((h) => h.remove());
    };
  }, []);
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
      if (mounted.current && pendingChannel.current) {
        const next = pendingChannel.current;
        pendingChannel.current = null;
        setChannel(next);
      } else if (mounted.current && pendingForcedCheck.current) {
        pendingForcedCheck.current = false;
        void check();
      }
    }
  };
  const panelBlocked = android && (failedCheck || !!release?.available);
  const blocked = android && (checking || panelBlocked);
  return (
    <UpdateContext.Provider
      value={{
        enabled: android,
        check: () => void check(),
        busy: checking || working,
        message,
        checking,
        verified,
        blocked,
        channel,
        canChooseChannel,
        setChannel,
        setPrimaryAccess,
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
            {failedCheck && channel === "beta" && (
              <button
                className="button outline"
                onClick={() => setChannel("stable")}
              >
                العودة إلى القناة المستقرة
              </button>
            )}
            {instruction && <p role="status">{instruction}</p>}
            {!checking && !working && (
              <>
                {failedCheck ? (
                  <button
                    className="button gold"
                    onClick={() => void check()}
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
