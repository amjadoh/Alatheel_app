import type { State, Row } from "./domain";
import { ensure } from "./domain";
import { financialSummary } from "./finance";

export const financialActions = new Set([
  "stock.purchase",
  "stock.reconcile",
  "feeding.skip",
  "finance.rollover",
  "finance.snapshot",
  "horse.save",
  "horse.checkout",
  "horse.restore",
  "request.accept",
  "meal.save",
  "meal.delete",
  "expense.save",
  "expense.delete",
  "expense.pay",
  "expense.payment.void",
  "income.pay",
  "income.correct",
  "income.void",
  "income.collect",
]);
const sources = [
  "horses",
  "mealTypes",
  "expenses",
  "income",
  "expensePayments",
] as const;
export const followingMonth = (m: string) =>
  new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 1))
    .toISOString()
    .slice(0, 7);
function basis(s: State) {
  return structuredClone(
    Object.fromEntries(
      sources.map((name) => [
        name,
        s[name].map((row) => {
          const copy = { ...row };
          for (const key of ["photoURL", "imageUrl", "imageURL"])
            delete copy[key];
          return copy;
        }),
      ]),
    ),
  );
}
export function closePeriods(s: State, today: string) {
  const month = today.slice(0, 7);
  const open = s.financialPeriods
    .filter((p) => !p.closed && p.id < month)
    .sort((a, b) => a.id.localeCompare(b.id));
  for (const p of open) {
    const previous = { ...s, ...p.basis, financialPeriods: [] } as State;
    let cursor = p.id,
      count = 0;
    while (cursor < month && count++ < 120) {
      if (!s.financialPeriods.some((x) => x.id === cursor && x.closed)) {
        const summary = financialSummary(previous, cursor);
        const closed = {
          id: cursor,
          closed: true,
          summary,
          basis: p.basis,
          createdAt: today + "T09:00:00.000Z",
          source: "automatic",
          basisStartedAt: p.basisStartedAt || p.createdAt,
        };
        ensure(
          new TextEncoder().encode(JSON.stringify(closed)).length < 850000,
          "حجم الشهر المغلق يحتاج ترقية التخزين؛ لم تُحفظ العملية",
        );
        s.financialPeriods = s.financialPeriods.filter((x) => x.id !== cursor);
        s.financialPeriods.push(closed);
      }
      cursor = followingMonth(cursor);
    }
    ensure(cursor === month, "تحتاج الفترات القديمة إلى ترحيل قبل المتابعة");
  }
}
export function refreshPeriod(s: State, today: string) {
  const month = today.slice(0, 7),
    old = s.financialPeriods.find((p) => p.id === month);
  ensure(!old?.closed, "الشهر مغلق ولا يقبل تعديلًا");
  for (const h of s.horses)
    if (!h.boardingHistory?.length)
      h.boardingHistory = [
        {
          month: "0000-00",
          fee: Number(h.boardingFee || 0),
          policy: h.billingPolicy || "full_month",
        },
      ];
  const data = basis(s);
  // Keep well below Firestore's 1 MiB document limit, including UTF-8 Arabic.
  ensure(
    new TextEncoder().encode(JSON.stringify(data)).length < 600000,
    "حجم أساس الحساب الشهري يحتاج ترقية التخزين؛ لم تُحفظ العملية",
  );
  const p: Row = {
    id: month,
    closed: false,
    basis: data,
    createdAt: old?.createdAt || today + "T09:00:00.000Z",
    updatedAt: today + "T09:00:00.000Z",
    basisStartedAt: old?.basisStartedAt || today,
  };
  s.financialPeriods = s.financialPeriods.filter((x) => x.id !== month);
  s.financialPeriods.push(p);
}
export function assertOpenPeriod(s: State, day: string) {
  ensure(
    !s.financialPeriods.some((p) => p.id === day.slice(0, 7) && p.closed),
    "هذا الشهر محفوظ ومغلق؛ اختر تاريخًا في شهر مفتوح",
  );
}
