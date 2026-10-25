import type { Row, State } from "./domain";
import { horseAccount } from "./accounts";
export type AlertKind =
  "collection_due" | "stock_low" | "stock_empty" | "app_update" | "app_feedback";
export type StaffAlert = {
  key: string;
  kind: AlertKind;
  title: string;
  body: string;
  page: "income" | "inventory" | "update" | "feedback";
  horseId?: string;
  mealTypeId?: string;
  amount?: number;
  versionCode?: number;
};
export type StockAlertState = {
  phase: "healthy" | "low" | "empty";
  sequence: number;
};
const amount = (n: number) =>
  "\u2066" +
  n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }) +
  "\u2069";
export function riyadhClock(now: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Riyadh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(now));
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
}
export const eligibleStaff = (u: Row) =>
  ["admin", "employee"].includes(u.role) &&
  u.disabled === false &&
  u.membershipApproved === true;
export const eligiblePushUser = (u: Row) =>
  ["admin", "employee", "owner", "viewer"].includes(u.role) &&
  u.disabled === false &&
  u.membershipApproved === true;
export const allowedAlertKinds = (u: Row): AlertKind[] =>
  eligibleStaff(u)
    ? ["collection_due", "stock_low", "stock_empty", "app_update", ...(String(u.email).toLowerCase()==="amjadoh@gmail.com"?["app_feedback" as const]:[])]
    : eligiblePushUser(u)
      ? ["app_update"]
      : [];
export function appUpdateAlert(manifest: any): StaffAlert {
  const version = String(manifest?.versionName || "");
  if (
    !/^\d+\.\d+\.\d+$/.test(version) ||
    !Number.isSafeInteger(manifest?.versionCode) ||
    manifest.versionCode < 10 ||
    manifest.packageId !== "com.alatheel.stable" ||
    manifest.url !==
      `https://alatheel-app-426403695200.web.app/downloads/Alatheel-${version}.apk` ||
    !/^[a-f0-9]{64}$/.test(manifest.sha256 || "") ||
    !Number.isSafeInteger(manifest.size) ||
    manifest.size <= 0 ||
    manifest.size > 100 * 1024 * 1024
  )
    throw new Error("بيانات إصدار التطبيق غير صالحة للإعلان");
  return {
    key: `release_${manifest.versionCode}`,
    kind: "app_update",
    title: "تحديث جديد للأثيل",
    body: `الإصدار \u2066${version}\u2069 متاح الآن. اضغط لتحديث التطبيق.`,
    page: "update",
    versionCode: manifest.versionCode,
  };
}
/** At most three attempts within 24 hours; no seven-day platform retry policy. */
export function deliveryDecision(row: Row, now = Date.now()) {
  if (["sent", "cancelled", "failed", "not_needed"].includes(row.deliveryState))
    return "done";
  if (row.deliveryState === "sending" && Number(row.leaseUntil) > now)
    return "leased";
  if (
    !Number.isFinite(Date.parse(row.createdAt)) ||
    now - Date.parse(row.createdAt) >= 86400000
  )
    return "expired";
  return Number(row.deliveryAttempts || 0) >= 3 ? "limit" : "ready";
}
export function deviceWantsAlert(
  device: Row,
  alert: StaffAlert,
  now = Date.now(),
) {
  return (
    device.enabled === true &&
    Number(device.sessionExpiresAt) > now &&
    (alert.kind === "app_feedback" || !device.kinds || device.kinds.includes(alert.kind)) &&
    (alert.kind !== "app_update" ||
      Number(device.installedVersionCode || 0) < Number(alert.versionCode))
  );
}
export function collectionDueAlerts(s: State, today: string): StaffAlert[] {
  return s.horses.flatMap((h) => {
    if (h.status === "private" || h.previousStatus === "private") return [];
    const remaining = horseAccount(s, h, today)
      .items.filter((x) => x.dueDate === today)
      .reduce((n, x) => n + x.remaining, 0);
    if (remaining < 0.005) return [];
    return [
      {
        key: `due_${h.id}_${today}`,
        kind: "collection_due" as const,
        title: "استحقاق تحصيل اليوم",
        body: `${h.name} · المتبقي ${amount(remaining)} ر.س`,
        page: "income" as const,
        horseId: h.id,
        amount: Math.round(remaining * 100) / 100,
      },
    ];
  });
}
export function stockAlert(
  meal: Row,
  old?: StockAlertState,
): { state: StockAlertState; alert?: StaffAlert } {
  const stock = Number(meal.currentStock || 0),
    threshold = Number(meal.minThreshold || 0);
  const phase = stock <= 0 ? "empty" : stock <= threshold ? "low" : "healthy";
  const sequence = (old?.sequence || 0) + (old?.phase === phase ? 0 : 1);
  const state = { phase, sequence } as StockAlertState;
  const rank = { healthy: 0, low: 1, empty: 2 };
  if (phase === "healthy" || rank[phase] <= rank[old?.phase || "healthy"])
    return { state };
  const empty = phase === "empty";
  return {
    state,
    alert: {
      key: `stock_${meal.id}_${phase}_${sequence}`,
      kind: empty ? "stock_empty" : "stock_low",
      title: `${empty ? "نفاد" : "انخفاض"} مخزون ${meal.name}`,
      body: `${meal.name} · الرصيد المحسوب \u2066${stock.toLocaleString("en-US", { maximumFractionDigits: 8 })}\u2069 ${meal.unit}`,
      page: "inventory",
      mealTypeId: meal.id,
    },
  };
}
/** Push banners omit financial details; the authenticated inbox provides the complete alert. */
export function pushCopy(kind: AlertKind) {
  if(kind==="app_feedback")return {title:"بلاغ جديد على تطبيق الأثيل",body:"وصل بلاغ جديد. افتح التطبيق لمراجعته."};
  if (kind === "app_update")
    return {
      title: "تحديث جديد للأثيل",
      body: "يتوفر إصدار جديد. افتح التطبيق للتحديث.",
    };
  return kind === "collection_due"
    ? {
        title: "استحقاق تحصيل اليوم",
        body: "يوجد مبلغ مستحق. افتح الأثيل لمراجعة كشف الحساب.",
      }
    : kind === "stock_low"
      ? {
          title: "انخفاض المخزون",
          body: "وصل أحد الأصناف إلى حد التنبيه. افتح الأثيل للمراجعة.",
        }
      : {
          title: "نفاد المخزون",
          body: "نفد الرصيد المحسوب لأحد الأصناف. افتح الأثيل للمراجعة.",
        };
}
