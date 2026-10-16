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

type Release = {
  available: boolean;
  versionName: string;
  notes: string;
  ready: boolean;
};
export interface UpdaterPlugin {
  check(): Promise<Release>;
  download(): Promise<void>;
  install(): Promise<{ permissionRequired: boolean }>;
  addListener(
    event: "progress",
    callback: (p: { percent: number }) => void,
  ): Promise<PluginListenerHandle>;
}
const Updater = registerPlugin<UpdaterPlugin>("AppUpdater");
const isAndroid = Capacitor.getPlatform() === "android";
const UpdateContext = createContext({
  check: () => {},
  busy: false,
  message: "",
});

export function UpdateButton() {
  const { check, busy, message } = useContext(UpdateContext);
  if (!isAndroid) return null;
  return (
    <section className="card update-card">
      <h3>تحديث التطبيق</h3>
      <p className="muted small">الإصدار {RELEASE_VERSION} · يجري التحقق عند فتح التطبيق</p>
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
  const [checking, setChecking] = useState(android);
  const [release, setRelease] = useState<Release | null>(null);
  const [failedCheck, setFailedCheck] = useState(false);
  const [working, setWorking] = useState(false);
  const [percent, setPercent] = useState(0);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [instruction, setInstruction] = useState("");
  const locked = useRef(false);
  const mounted = useRef(true);
  const check = async (manual = false) => {
    if (!android || locked.current) return;
    locked.current = true;
    setChecking(true);
    setError("");
    try {
      const result = await client.check();
      if (!mounted.current) return;
      setRelease(result);
      setFailedCheck(false);
      if (manual && !result.available)
        setMessage("تستخدم أحدث إصدار من التطبيق");
    } catch (e) {
      if (mounted.current) {
        setFailedCheck(true);
        setError((e as Error).message || "تعذر التحقق من التحديث");
      }
    } finally {
      locked.current = false;
      if (mounted.current) setChecking(false);
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
      if (isActive) void check();
    });
    return () => {
      mounted.current = false;
      void progress.then((h) => h.remove());
      void resume.then((h) => h.remove());
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
        setRelease({ ...release, ready: true });
      }
      const result = await client.install();
      setInstruction(
        result.permissionRequired
          ? "فعّل «السماح من هذا المصدر» للأثيل، ثم ارجع واضغط «تثبيت التحديث»."
          : "اختر «تحديث» في شاشة أندرويد. إذا أغلقتها، اضغط «تثبيت التحديث» مجددًا.",
      );
    } catch (e) {
      setError((e as Error).message || "تعذر تحديث التطبيق. أعد المحاولة.");
      setRelease({ ...release, ready: false });
    } finally {
      locked.current = false;
      setWorking(false);
    }
  };
  const blocked = android && (checking || failedCheck || release?.available);
  return (
    <UpdateContext.Provider
      value={{
        check: () => void check(true),
        busy: checking || working,
        message,
      }}
    >
      <div hidden={!!blocked} inert={blocked ? true : undefined}>
        {children}
      </div>
      {blocked && (
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
            {instruction && <p role="status">{instruction}</p>}
            {!checking && !working && (
              <>
                {failedCheck ? (
                  <button
                    className="button gold"
                    onClick={() => void check(true)}
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

