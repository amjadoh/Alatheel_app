import { useEffect, useMemo, useRef, useState } from "react";
import {
  collection,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  doc,
  getDoc,
  updateDoc,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { App as NativeApp } from "@capacitor/app";
import { Bell, Wallet, Package, AlertCircle, Download, MessageSquare, ShieldCheck, Search, Send, Eye, X } from "lucide-react";
import {
  getNotificationServices,
  staff,
  errorText,
  type Actor,
  type Row,
} from "./service";
import {
  androidPush,
  StaffPush,
  pushDeviceId,
  type PushOpen,
} from "./native-push";
import { displayDate, displayNumber } from "./format";
export type StaffAlert = {
  id: string;
  title: string;
  body: string;
  kind: string;
  read: boolean;
  createdAt: string;
  page: "income" | "inventory" | "update" | "feedback" | "notifications";
  horseId?: string;
  mealTypeId?: string;
  channel?: "stable" | "beta";
};
const allKinds = ["collection_due", "stock_low", "stock_empty", "app_update"];
export function useStaffNotifications(
  actor: Actor | null,
  onOpen: (target: {
    page: "income" | "inventory" | "update" | "feedback" | "notifications";
    horseId?: string;
    mealTypeId?: string;
     channel?: "stable" | "beta";
  }) => void,
) {
  const [alerts, setAlerts] = useState<StaffAlert[]>([]),
    [enabled, setEnabled] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [kinds, setKindsState] = useState<string[]>(allKinds),
    callback = useRef(onOpen),
    opened = useRef(new Set<string>());
  callback.current = onOpen;
  const kindsRef = useRef(kinds);
  kindsRef.current = kinds;
  const uid = actor?.uid || "",
    isStaff = !!actor && staff(actor);
  const allowedKinds = isStaff ? allKinds : ["app_update"];
  const services = getNotificationServices();
  async function register(token: string, selected = kinds) {
    if (!services || !uid) return;
    const info = await NativeApp.getInfo();
    await httpsCallable(
      services.functions,
      "updatePushDevice",
    )({
      deviceId: pushDeviceId(),
      token,
      enabled: true,
      kinds: selected,
      installedVersionCode: Number(info.build),
    });
  }
  async function open(alert: StaffAlert) {
    if (!uid || !services) return;
    await updateDoc(doc(services.db, "users", uid, "staffAlerts", alert.id), {
      read: true,
    }).catch(() => {});
    if (["income", "inventory", "update", "feedback", "notifications"].includes(alert.page))
      callback.current({
        page: alert.page,
        horseId: alert.horseId,
        mealTypeId: alert.mealTypeId,
         channel: alert.channel,
      });
  }
  const openRef = useRef(open);
  openRef.current = open;
  useEffect(() => {
    if (!uid || !services) {
      setAlerts([]);
      return;
    }
    let alive = true;
    opened.current.clear();
    let selected = allowedKinds;
    try {
      const saved = JSON.parse(
        localStorage.getItem("alatheel.push.kinds." + uid) || "null",
      );
      if (Array.isArray(saved))
        selected = saved.filter((x) => allowedKinds.includes(x));
    } catch {}
    try {
      if (!localStorage.getItem("alatheel.push.update-default." + uid)) {
        selected = [...new Set([...selected, "app_update"])];
        localStorage.setItem("alatheel.push.update-default." + uid, "yes");
      }
    } catch {}
    kindsRef.current = selected;
    setKindsState(selected);
    const unsub = onSnapshot(
      query(
        collection(services.db, "users", uid, "staffAlerts"),
        ...(isStaff ? [] : [where("kind", "in", ["app_update", "management_message"])]),
        orderBy("createdAt", "desc"),
        limit(100),
      ),
      (snap) => {
        if (alive)
          setAlerts(
            snap.docs.map((d) => ({ id: d.id, ...d.data() }) as StaffAlert),
          );
      },
      (e) => {
        if (alive) setError(errorText(e));
      },
    );
    async function handle(value: PushOpen) {
      if (
        !alive ||
        value.userId !== uid ||
        !value.alertId ||
        opened.current.has(value.alertId)
      )
        return;
      opened.current.add(value.alertId);
      try {
        const snap = await getDoc(
          doc(services!.db, "users", uid, "staffAlerts", value.alertId),
        );
        if (alive && snap.exists())
          await openRef.current({ id: snap.id, ...snap.data() } as StaffAlert);
      } catch {
        opened.current.delete(value.alertId);
      }
    }
    async function sync() {
      if (!alive || !androidPush) return;
      try {
        await StaffPush.session({ userId: uid, deviceId: pushDeviceId() });
        const status = await StaffPush.status();
        if (alive) setEnabled(status.enabled);
        if (status.enabled) {
          const result = await StaffPush.token();
          if (alive && result.token)
            await register(result.token, kindsRef.current);
        }
        await handle(await StaffPush.pending());
      } catch (e) {
        if (alive) setError(errorText(e));
      }
    }
    let removeNative: undefined | (() => void),
      removeResume: undefined | (() => void);
    if (androidPush) {
      void StaffPush.addListener("open", (v) => void handle(v)).then((h) => {
        if (alive) removeNative = () => void h.remove();
        else void h.remove();
      });
      void NativeApp.addListener("appStateChange", ({ isActive }) => {
        if (isActive) void sync();
      }).then((h) => {
        if (alive) removeResume = () => void h.remove();
        else void h.remove();
      });
      void sync();
    }
    return () => {
      alive = false;
      unsub();
      removeNative?.();
      removeResume?.();
    };
  }, [uid, isStaff, services?.db, services?.functions]);
  async function enable() {
    if (!androidPush || !uid) return;
    setBusy(true);
    setError("");
    try {
      await StaffPush.session({ userId: uid, deviceId: pushDeviceId() });
      const result = await StaffPush.enable();
      if (!result.enabled || !result.token)
        throw new Error(
          "اسمح بإشعارات الأثيل من إعدادات الجوال ثم أعد المحاولة",
        );
      await register(result.token);
      setEnabled(true);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function disable() {
    setBusy(true);
    setError("");
    try {
      await StaffPush.disable();
      if (services)
        await httpsCallable(
          services.functions,
          "updatePushDevice",
        )({ action: "remove", deviceId: pushDeviceId() });
      setEnabled(false);
    } catch (e) {
      setEnabled(false);
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function setKinds(next: string[]) {
    kindsRef.current = next;
    setKindsState(next);
    try {
      localStorage.setItem("alatheel.push.kinds." + uid, JSON.stringify(next));
      if (enabled) {
        const result = await StaffPush.token();
        await register(result.token, next);
      }
    } catch (e) {
      setError(errorText(e));
    }
  }
  return {
    isStaff,
    alerts,
    unread: alerts.filter((x) => !x.read).length,
    enabled,
    busy,
    error,
    enable,
    disable,
    open,
    kinds,
    setKinds,
  };
}
const roleNames: Record<string, string> = {
  admin: "مدير",
  employee: "موظف",
  owner: "مالك خيل",
  viewer: "مشاهد",
};
function ManagementMessageComposer({ users }: { users: Row[] }) {
  const recipients = useMemo(
      () => users.filter((u) => u.membershipApproved === true && !u.disabled && !u.deleted),
      [users],
    ),
    [selected, setSelected] = useState<string[]>([]),
    [body, setBody] = useState(""),
    [search, setSearch] = useState(""),
    [pickerOpen, setPickerOpen] = useState(false),
    [previewOpen, setPreviewOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    requestId = useRef(crypto.randomUUID()),
    dialog = useRef<HTMLDialogElement>(null),
    services = getNotificationServices(),
    filtered = recipients.filter((u) =>
      `${u.displayName || ""} ${u.email || ""} ${roleNames[u.role] || ""}`
        .toLowerCase()
        .includes(search.trim().toLowerCase()),
    ),
    ready = selected.length > 0 && body.trim().length > 0;
  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    if (previewOpen && !node.open) node.showModal();
    if (!previewOpen && node.open) node.close();
  }, [previewOpen]);
  const toggle = (id: string) =>
    setSelected((current) =>
      current.includes(id)
        ? current.filter((value) => value !== id)
        : [...current, id],
    );
  async function sendMessage() {
    if (!ready || !services) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await httpsCallable(
        services.functions,
        "sendManagementMessage",
      )({ recipientIds: selected, body: body.trim(), requestId: requestId.current });
      const count = Number((response.data as any)?.recipients || selected.length);
      setPreviewOpen(false);
      setNotice(`تمت إضافة الرسالة إلى إشعارات ${displayNumber(count)} من الأعضاء`);
      setSelected([]);
      setBody("");
      requestId.current = crypto.randomUUID();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="card management-message-composer">
      <div className="spread">
        <h2>إرسال إشعار</h2>
        <span className="pill primary-only"><ShieldCheck size={15}/> المدير الأساسي فقط</span>
      </div>
      <div className="field">
        <span>المستلمون</span>
        <button
          className="recipient-picker-button"
          type="button"
          aria-expanded={pickerOpen}
          onClick={() => setPickerOpen((value) => !value)}
        >
          <span>{selected.length ? `تم اختيار ${displayNumber(selected.length)} من الأعضاء` : "اختر شخصًا أو أكثر"}</span>
          <Search size={17}/>
        </button>
      </div>
      {pickerOpen && (
        <div className="recipient-picker">
          <label className="recipient-search">
            <Search size={16}/>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ابحث بالاسم أو البريد أو الصفة"/>
          </label>
          <label className="recipient-option all">
            <input
              type="checkbox"
              checked={recipients.length > 0 && selected.length === recipients.length}
              onChange={(e) => setSelected(e.target.checked ? recipients.map((u) => u.id) : [])}
            />
            <span><b>تحديد جميع الأعضاء النشطين</b><small>اختيار صريح، وليس افتراضيًا</small></span>
          </label>
          {filtered.map((u) => (
            <label className="recipient-option" key={u.id}>
              <input type="checkbox" checked={selected.includes(u.id)} onChange={() => toggle(u.id)}/>
              <span><b>{u.displayName || u.email}</b><small>{roleNames[u.role] || u.role} · {u.email}</small></span>
            </label>
          ))}
          {!filtered.length && <p className="muted small">لا توجد نتائج مطابقة</p>}
        </div>
      )}
      {!!selected.length && (
        <div className="recipient-chips" aria-live="polite">
          {recipients.filter((u) => selected.includes(u.id)).map((u) => (
            <span key={u.id}>{u.displayName || u.email}<button type="button" aria-label={`إزالة ${u.displayName || u.email}`} onClick={() => toggle(u.id)}><X size={13}/></button></span>
          ))}
        </div>
      )}
      <span className="field-label">عنوان الإشعار</span>
      <div className="management-message-title"><ShieldCheck size={17}/> رسالة من إدارة الإسطبل</div>
      <label className="field">
        <span>نص الرسالة</span>
        <textarea maxLength={500} value={body} onChange={(e) => {setBody(e.target.value);setNotice("");setError("");}} placeholder="مثال: نرجو تحديث بيانات الخيل قبل نهاية اليوم."/>
      </label>
      <p className="muted small message-length">{displayNumber(body.length)} / {displayNumber(500)}</p>
      <div className="message-actions">
        <button className="button outline" type="button" disabled={!ready || busy} onClick={() => setPreviewOpen(true)}><Eye size={17}/> معاينة</button>
        <button className="button gold" type="button" disabled={!ready || busy} onClick={() => setPreviewOpen(true)}><Send size={17}/> إرسال الإشعار</button>
      </div>
      {notice && <p className="notice success" role="status">{notice}</p>}
      {error && <p className="notice error" role="alert">{error}</p>}
      <dialog aria-labelledby="management-message-preview-title" ref={dialog} onCancel={(e) => {e.preventDefault();setPreviewOpen(false);}}>
        <div className="modal-heading"><h2 id="management-message-preview-title">معاينة الإشعار</h2><button className="icon-button" type="button" aria-label="إغلاق" onClick={() => setPreviewOpen(false)}><X/></button></div>
        <div className="modal-body">
          <div className="management-message-preview"><Bell size={20}/><span><b>رسالة من إدارة الإسطبل</b><span>{body.trim()}</span></span></div>
          <p className="muted">سيُرسل إلى {displayNumber(selected.length)}: {recipients.filter((u) => selected.includes(u.id)).map((u) => u.displayName || u.email).join("، ")}</p>
          <div className="message-actions">
            <button className="button outline" type="button" disabled={busy} onClick={() => setPreviewOpen(false)}>تعديل</button>
            <button className="button gold" type="button" disabled={busy} onClick={() => void sendMessage()}><Send size={17}/>{busy ? "جارٍ الإرسال…" : "تأكيد الإرسال"}</button>
          </div>
        </div>
      </dialog>
    </div>
  );
}
export function NotificationsPanel({
  notifications: n,
  primaryAdmin = false,
  users = [],
}: {
  notifications: ReturnType<typeof useStaffNotifications>;
  primaryAdmin?: boolean;
  users?: Row[];
}) {
  return (
    <section className="notification-page" dir="rtl">
      {primaryAdmin && <ManagementMessageComposer users={users}/>}
      <div className="card">
        <div className="spread">
          <h2>تنبيهاتك</h2>
          <span className="pill">{n.isStaff ? "المدير والموظف" : "حسابك"}</span>
        </div>
        {n.isStaff && (
          <p className="muted small">
            يوم استحقاق التحصيل · {displayNumber(9)} مساءً بتوقيت السعودية
          </p>
        )}
        {[
          ["app_update", "إصدار جديد للتطبيق"],
          ...(n.isStaff
            ? [
                ["collection_due", "استحقاق التحصيل"],
                ["stock_low", "انخفاض المخزون"],
                ["stock_empty", "نفاد المخزون"],
              ]
            : []),
        ].map(([id, label]) => (
          <label className="notification-toggle" key={id}>
            <span>{label}</span>
            <input
              type="checkbox"
              checked={n.kinds.includes(id)}
              onChange={(e) =>
                void n.setKinds(
                  e.target.checked
                    ? [...n.kinds, id]
                    : n.kinds.filter((x) => x !== id),
                )
              }
            />
          </label>
        ))}
        {androidPush && (
          <button
            className="button gold"
            disabled={n.busy}
            onClick={() => void (n.enabled ? n.disable() : n.enable())}
          >
            <Bell size={18} />
            {n.enabled
              ? "إيقاف إشعارات هذا الجهاز"
              : "تفعيل إشعارات هذا الجهاز"}
          </button>
        )}
        {n.error && (
          <p className="notice error" role="alert">
            {n.error}
          </p>
        )}
      </div>
      <div className="card">
        <h2>الإشعارات</h2>
        {!n.alerts.length && <p className="muted">لا توجد إشعارات حتى الآن</p>}
        {n.alerts.map((a) => (
          <button
            className={`notification-row ${a.read ? "" : "unread"}`}
            key={a.id}
            onClick={() => void n.open(a)}
          >
            {a.kind === "management_message" ? (
              <MessageSquare size={20} />
            ) : a.kind === "app_update" ? (
              <Download size={20} />
            ) : a.kind === "collection_due" ? (
              <Wallet size={20} />
            ) : a.kind === "stock_low" ? (
              <Package size={20} />
            ) : (
              <AlertCircle size={20} />
            )}
            <span>
              <b>{a.title}</b>
              <span>{a.body}</span>
              <small>{displayDate(a.createdAt)}</small>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
