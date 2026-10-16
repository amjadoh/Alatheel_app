import { money, nextMonth } from "./domain";
import type { State, Row } from "./domain";
import { businessDay } from "./dates";
import { boardingAmount, boardingTerms } from "./boarding";

export type AccountItem = {
  id: string;
  kind: "boarding" | "expense";
  dueDate: string;
  name: string;
  amount: number;
  paid: number;
  remaining: number;
  expenseId?: string;
  baseFee?: number;
  billingPolicy?: string;
};
export const endOfMonth = (day: string) => {
  const [y, m] = day.slice(0, 7).split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};
const cents = (n: unknown) => Math.round(Number(n || 0) * 100);
export const isReceipt = (i: Row) =>
  i.status !== "void" && i.status !== "pending";
/** An unpaid legacy dueDate is the opening boundary, never a guessed entry-date debt. */
export function horseAccount(
  s: State,
  h: Row,
  asOf: string,
  horizon = endOfMonth(asOf),
) {
  const receipts = s.income.filter((i) => i.horseId === h.id && isReceipt(i));
  const items = new Map<string, AccountItem>();
  const add = (item: AccountItem) => {
    if (!items.has(item.id)) items.set(item.id, item);
  };
  const privateHorse =
    h.status === "private" ||
    (h.status === "archived" && h.previousStatus === "private");
  const stop =
    h.status === "archived" && h.exitDate
      ? [horizon, businessDay(h.exitDate)].sort()[0]
      : horizon;
  const frozen = new Map<string, Row>(
    (h.accountCycles || []).map((c: Row) => [c.dueDate, c]),
  );
  let cursor = businessDay(h.accountAnchor || h.dueDate),
    count = 0;
  while (
    !privateHorse &&
    /^\d{4}-\d{2}-\d{2}$/.test(cursor) &&
    cursor <= stop &&
    count++ < 1200
  ) {
    const value = frozen.get(cursor);
    add({
      id: "boarding_" + cursor,
      kind: "boarding",
      dueDate: cursor,
      name: "إيواء " + cursor.slice(0, 7),
      amount:
        value?.billingPolicy === "per_day"
          ? boardingAmount(h, cursor.slice(0, 7), value.baseFee, "per_day")
          : money(
              Number(value?.amount ?? boardingAmount(h, cursor.slice(0, 7))),
            ),
      baseFee:
        value?.baseFee ??
        value?.amount ??
        boardingTerms(h, cursor.slice(0, 7)).fee,
      billingPolicy:
        value?.billingPolicy || boardingTerms(h, cursor.slice(0, 7)).policy,
      paid: 0,
      remaining: 0,
    });
    cursor = nextMonth(cursor);
  }
  // Legacy receipts retain their original fee and expense snapshots, including historical cutoffs.
  for (const r of receipts.filter((r) => !privateHorse && !r.accountVersion)) {
    const d = businessDay(r.dueDate);
    if (d && d <= stop)
      add({
        id: "boarding_" + d,
        kind: "boarding",
        dueDate: d,
        name: "إيواء " + d.slice(0, 7),
        amount: money(
          Number(
            r.boardingFee ??
              Number(r.amount || 0) -
                (r.expenseShares || []).reduce(
                  (n: number, x: any) => n + Number(x.amount || 0),
                  0,
                ),
          ),
        ),
        paid: 0,
        remaining: 0,
      });
  }
  for (const e of s.expenses) {
    const amount = Number(e.allocations?.[h.id] || 0),
      dueDate = businessDay(e.incurredAt || e.createdAt);
    if (
      privateHorse ||
      !amount ||
      e.frequency !== "once" ||
      !dueDate ||
      dueDate > horizon
    )
      continue;
    const legacy = receipts.some(
      (r) =>
        !r.accountVersion &&
        r.expenseShares?.some((x: any) => x.expenseId === e.id),
    );
    if (e.collectedHorseIds?.includes(h.id) && !legacy && !h.accountVersion)
      continue;
    add({
      id: "expense_" + e.id,
      kind: "expense",
      expenseId: e.id,
      dueDate,
      name: e.name,
      amount: money(amount),
      paid: 0,
      remaining: 0,
    });
  }
  for (const x of privateHorse ? [] : h.accountExtras || [])
    if (x.dueDate <= horizon)
      add({ ...x, kind: "expense", paid: 0, remaining: 0 });
  const paid = new Map<string, number>();
  let credit = 0;
  for (const r of receipts.filter((r) => businessDay(r.collectedAt) <= asOf)) {
    if (r.accountVersion) {
      let allocated = 0;
      for (const x of r.allocations || []) {
        paid.set(x.id, (paid.get(x.id) || 0) + cents(x.amount));
        // A cycle beyond checkout or beyond this report's horizon is still prepaid credit.
        if (items.has(x.id)) allocated += cents(x.amount);
      }
      credit += Math.max(0, cents(r.amount) - allocated);
    } else {
      const id = "boarding_" + businessDay(r.dueDate),
        item = items.get(id);
      paid.set(
        id,
        (paid.get(id) || 0) + cents(r.boardingFee ?? item?.amount ?? r.amount),
      );
      for (const x of r.expenseShares || [])
        paid.set(
          "expense_" + x.expenseId,
          (paid.get("expense_" + x.expenseId) || 0) + cents(x.amount),
        );
    }
  }
  const rows = [...items.values()].sort(
    (a, b) => a.dueDate.localeCompare(b.dueDate) || a.id.localeCompare(b.id),
  );
  credit += rows.reduce(
    (n, row) => n + Math.max(0, (paid.get(row.id) || 0) - cents(row.amount)),
    0,
  );
  for (const row of rows) {
    const amount = cents(row.amount),
      recorded = Math.min(amount, paid.get(row.id) || 0),
      use = Math.min(credit, Math.max(0, amount - recorded));
    credit -= use;
    row.paid = (recorded + use) / 100;
    row.remaining = (amount - recorded - use) / 100;
  }
  return {
    items: rows,
    receipts: receipts
      .filter((r) => businessDay(r.collectedAt) <= asOf)
      .sort((a, b) =>
        String(b.collectedAt).localeCompare(String(a.collectedAt)),
      ),
    outstanding: money(rows.reduce((n, x) => n + x.remaining, 0)),
    arrears: money(
      rows
        .filter((x) => x.dueDate < asOf.slice(0, 7) + "-01")
        .reduce((n, x) => n + x.remaining, 0),
    ),
    dueNow: money(
      rows
        .filter(
          (x) => x.dueDate >= asOf.slice(0, 7) + "-01" && x.dueDate <= asOf,
        )
        .reduce((n, x) => n + x.remaining, 0),
    ),
    upcoming: money(
      rows.filter((x) => x.dueDate > asOf).reduce((n, x) => n + x.remaining, 0),
    ),
    credit: credit / 100,
    charged: money(rows.reduce((n, x) => n + x.amount, 0)),
    paid: money(
      receipts
        .filter((r) => businessDay(r.collectedAt) <= asOf)
        .reduce((n, r) => n + Number(r.amount), 0),
    ),
  };
}
export function accountRevision(s: State, h: Row) {
  const canonical = (value: any): any =>
    Array.isArray(value)
      ? value.map(canonical)
      : value && typeof value === "object"
        ? Object.fromEntries(
            Object.keys(value)
              .sort()
              .map((k) => [k, canonical(value[k])]),
          )
        : value;
  const source = JSON.stringify(
    canonical([
      h,
      s.income
        .filter((i) => i.horseId === h.id)
        .sort((a, b) => a.id.localeCompare(b.id)),
      s.expenses
        .filter((e) => e.allocations?.[h.id])
        .sort((a, b) => a.id.localeCompare(b.id)),
    ]),
  );
  let hash = 2166136261;
  for (let i = 0; i < source.length; i++)
    hash = Math.imul(hash ^ source.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16);
}
export function planPayment(
  s: State,
  h: Row,
  data: Record<string, any>,
  today: string,
) {
  const account = horseAccount(s, h, today);
  const month = String(data.paidAt || "").slice(0, 7),
    mode = data.paymentType;
  const selected = new Set<string>(data.periods || []);
  const targets = account.items.filter(
    (x) =>
      x.remaining > 0 &&
      (mode === "monthly"
        ? x.dueDate.slice(0, 7) === month
        : mode === "arrears"
          ? x.dueDate.slice(0, 7) < month && selected.has(x.dueDate.slice(0, 7))
          : x.dueDate.slice(0, 7) <= month),
  );
  const selectedBalance = money(targets.reduce((n, x) => n + x.remaining, 0));
  const amount = money(Number(data.amount)),
    allocations: Record<string, any>[] = [];
  let left = cents(amount);
  for (const x of targets) {
    const part = Math.min(Math.max(0, left), cents(x.remaining));
    if (part)
      allocations.push({
        id: x.id,
        kind: x.kind,
        dueDate: x.dueDate,
        name: x.name,
        ...(x.expenseId ? { expenseId: x.expenseId } : {}),
        amount: part / 100,
      });
    left -= part;
  }
  return {
    account,
    amount,
    selectedBalance,
    allocations,
    advance: Math.max(0, left) / 100,
    remaining: money(Math.max(0, account.outstanding - amount)),
  };
}
