import type { Row, State } from "./domain";
import { horseAccount } from "./accounts";
export type AlertKind = "collection_due" | "stock_low" | "stock_empty";
export type StaffAlert = { key: string; kind: AlertKind; title: string; body: string; page: "income" | "inventory"; horseId?: string; mealTypeId?: string; amount?: number };
export type StockAlertState = { phase: "healthy" | "low" | "empty"; sequence: number };
const amount = (n: number) => "\u2066" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + "\u2069";
export function riyadhClock(now: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(new Date(now));
  const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
}
export const eligibleStaff = (u: Row) => ["admin", "employee"].includes(u.role) && u.disabled === false && u.membershipApproved === true;
export function collectionDueAlerts(s: State, today: string): StaffAlert[] {
  return s.horses.flatMap(h => {
    if (h.status === "private" || h.previousStatus === "private") return [];
    const remaining = horseAccount(s, h, today).items.filter(x => x.dueDate === today).reduce((n, x) => n + x.remaining, 0);
    if (remaining < 0.005) return [];
    return [{ key: `due_${h.id}_${today}`, kind: "collection_due" as const, title: "استحقاق تحصيل اليوم", body: `${h.name} · المتبقي ${amount(remaining)} ر.س`, page: "income" as const, horseId: h.id, amount: Math.round(remaining * 100) / 100 }];
  });
}
export function stockAlert(meal: Row, old?: StockAlertState): { state: StockAlertState; alert?: StaffAlert } {
  const stock = Number(meal.currentStock || 0), threshold = Number(meal.minThreshold || 0);
  const phase = stock <= 0 ? "empty" : stock <= threshold ? "low" : "healthy";
  const sequence = (old?.sequence || 0) + (old?.phase === phase ? 0 : 1);
  const state = { phase, sequence } as StockAlertState;
  const rank = { healthy: 0, low: 1, empty: 2 };
  if (phase === "healthy" || rank[phase] <= rank[old?.phase || "healthy"]) return { state };
  const empty = phase === "empty";
  return { state, alert: { key: `stock_${meal.id}_${phase}_${sequence}`, kind: empty ? "stock_empty" : "stock_low", title: `${empty ? "نفاد" : "انخفاض"} مخزون ${meal.name}`, body: `${meal.name} · الرصيد المحسوب \u2066${stock.toLocaleString("en-US", { maximumFractionDigits: 8 })}\u2069 ${meal.unit}`, page: "inventory", mealTypeId: meal.id } };
}
/** Push banners omit financial details; the authenticated inbox provides the complete alert. */
export function pushCopy(kind: AlertKind) {
  return kind === "collection_due" ? { title: "استحقاق تحصيل اليوم", body: "يوجد مبلغ مستحق. افتح الأثيل لمراجعة كشف الحساب." } : kind === "stock_low" ? { title: "انخفاض المخزون", body: "وصل أحد الأصناف إلى حد التنبيه. افتح الأثيل للمراجعة." } : { title: "نفاد المخزون", body: "نفد الرصيد المحسوب لأحد الأصناف. افتح الأثيل للمراجعة." };
}
