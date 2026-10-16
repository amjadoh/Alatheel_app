import { money, nextMonth } from "./domain";
import type { State, Row } from "./domain";
import {
  costs,
  horseCost,
  monthlyExpense,
  isFeedPurchase,
  coveredFeedPlan,
} from "./estimates";
import { businessDay } from "./dates";
import { horseAccount } from "./accounts";
import { stayDays, boardingAmount } from "./boarding";

const collected = (i: Row) => i.status !== "pending" && i.status !== "void";
const day = businessDay;
export function cashCategory(e: Record<string, any>) {
  if (e.expenseKind === "feed_purchase") return "inventory";
  if (e.expenseCategory === "salary") return "salary";
  if (e.expenseCategory === "other") return "other";
  return /راتب|رواتب|salary|payroll/i.test(e.name || e.expenseName || "")
    ? "salary"
    : "other";
}
export function monthEnd(month: string) {
  monthlyExpense({ id: "validation", cost: 0 }, month); // Shared month validation.
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}
export function boardingPart(i: Row) {
  return money(
    Math.max(
      0,
      Number(
        i.boardingFee ??
          Number(i.amount || 0) -
            (i.expenseShares || []).reduce(
              (sum: number, e: any) => sum + Number(e.amount || 0),
              0,
            ),
      ),
    ),
  );
}
export function expensePaid(s: State, expenseId: string, period: string) {
  return money(
    s.expensePayments
      .filter(
        (p) =>
          p.expenseId === expenseId &&
          p.period === period &&
          p.status !== "void",
      )
      .reduce((sum, p) => sum + Number(p.amount), 0),
  );
}
export function expensePlan(s: State, expense: Row, period: string) {
  const closed = s.financialPeriods?.find((p) => p.id === period && p.closed);
  const record = closed
    ? closed.basis?.expenses.find((e: Row) => e.id === expense.id)
    : expense;
  return record ? monthlyExpense(record, period) : 0;
}
export function horseFinance(s: State, h: Row, month: string) {
  const closed = s.financialPeriods?.find((p) => p.id === month && p.closed);
  if (closed) {
    const row = closed.summary.horses.find((r: Row) => r.id === h.id);
    if (row) return row as ReturnType<typeof calculateHorseFinance>;
    return calculateHorseFinance(
      { ...s, financialPeriods: [] },
      { ...h, status: "archived", exitDate: "0001-01-01" },
      month,
    );
  }
  return calculateHorseFinance(s, h, month);
}
function calculateHorseFinance(s: State, h: Row, month: string) {
  const end = monthEnd(month);
  const start = `${month}-01`;
  const archived = h.status === "archived";
  const privateHorse =
    h.status === "private" || (archived && h.previousStatus === "private");
  const active = stayDays(h, month) > 0 && (!archived || !!h.exitDate);
  const c = horseCost(s, h, month);
  const food = active ? c.food : 0,
    other = active ? c.other : 0;
  const total = money(food + other);
  const receipts = s.income.filter((i) => i.horseId === h.id && collected(i));
  const cash = money(
    receipts
      .filter((i) => day(i.collectedAt).slice(0, 7) === month)
      .reduce((n, i) => n + Number(i.amount || 0), 0),
  );
  const expected = active && !privateHorse ? boardingAmount(h, month) : 0;
  const recoveredExpected = active
    ? money(
        s.expenses
          .filter(
            (e) =>
              !isFeedPurchase(s, e) &&
              e.frequency === "once" &&
              monthlyExpense(e, month) > 0,
          )
          .reduce((sum, e) => sum + Number(e.allocations?.[h.id] || 0), 0),
      )
    : 0;
  const dueEnd =
    archived && h.exitDate ? [end, day(h.exitDate)].sort()[0] : end;
  // dueDate is the next unpaid cycle. Paid receipts after the selected cut-off
  // restore historical debt without counting an already-paid cycle twice.
  const unpaid = new Map<string, number>();
  let due = day(h.dueDate),
    cycles = 0;
  while (
    !privateHorse &&
    /^\d{4}-\d{2}-\d{2}$/.test(due) &&
    due <= dueEnd &&
    cycles++ < 1200
  ) {
    unpaid.set(due, Number(h.boardingFee || 0));
    try {
      due = nextMonth(due);
    } catch {
      break;
    }
  }
  for (const i of receipts) {
    const d = day(i.dueDate);
    if (d && d <= dueEnd) {
      if (day(i.collectedAt) > end) unpaid.set(d, boardingPart(i));
      else unpaid.delete(d);
    }
  }
  const boardingOutstanding = money(
    [...unpaid.values()].reduce((n, value) => n + value, 0),
  );
  const extrasOutstanding = money(
    s.expenses
      .filter(
        (e) =>
          e.frequency === "once" && day(e.incurredAt || e.createdAt) <= end,
      )
      .reduce((sum, e) => {
        const amount = Number(e.allocations?.[h.id] || 0);
        if (!amount) return sum;
        const paidBeforeEnd = receipts.some(
          (i) =>
            day(i.collectedAt) <= end &&
            i.expenseShares?.some((x: any) => x.expenseId === e.id),
        );
        if (paidBeforeEnd) return sum;
        const paidAfterEnd = receipts.some(
          (i) =>
            day(i.collectedAt) > end &&
            i.expenseShares?.some((x: any) => x.expenseId === e.id),
        );
        return (
          sum +
          (!e.collectedHorseIds?.includes(h.id) || paidAfterEnd ? amount : 0)
        );
      }, 0),
  );
  const missing = active ? [...c.missingFeed] : [];
  if (active && !h.feeding?.some((f: any) => Number(f.quantity) > 0))
    missing.push("برنامج التغذية غير مسجل");
  if (
    active &&
    h.feeding?.some(
      (f: any) =>
        !s.mealTypes.some(
          (m) => m.id === f.mealTypeId && Number(m.pricePerUnit) > 0,
        ),
    )
  )
    missing.push("سعر أحد أصناف التغذية غير مسجل");
  const revenue = money(expected + recoveredExpected);
  const account = horseAccount(s, h, end, end);
  const ledgerBoarding = account
    ? money(
        account.items
          .filter((x) => x.kind === "boarding")
          .reduce((n, x) => n + x.remaining, 0),
      )
    : boardingOutstanding;
  const ledgerExtras = account
    ? money(
        account.items
          .filter((x) => x.kind === "expense")
          .reduce((n, x) => n + x.remaining, 0),
      )
    : extrasOutstanding;
  return {
    id: h.id,
    name: h.name,
    ownerName: h.ownerName || "",
    privateHorse,
    active,
    expected,
    recoveredExpected,
    revenue,
    food,
    other,
    total,
    margin: money(revenue - total),
    cash,
    boardingOutstanding: ledgerBoarding,
    extrasOutstanding: ledgerExtras,
    outstanding: money(ledgerBoarding + ledgerExtras),
    advanceCredit: account?.credit || 0,
    overdueCycles: account
      ? account.items.filter(
          (x) => x.kind === "boarding" && x.remaining > 0 && x.dueDate < start,
        ).length
      : [...unpaid.keys()].filter((d) => d < start).length,
    missing: [...new Set(missing)],
    complete: missing.length === 0,
    foodItems: active ? c.foodItems : [],
    expenseItems: active ? c.expenseItems : [],
    days: c.days,
  };
}
export function financialSummary(s: State, month: string) {
  const closed = s.financialPeriods?.find((p) => p.id === month && p.closed);
  if (closed) return closed.summary as ReturnType<typeof calculateSummary>;
  return calculateSummary(s, month);
}
function calculateSummary(s: State, month: string) {
  const rows = s.horses.map((h) => horseFinance(s, h, month));
  const base = costs(s, month);
  const recoveries = money(rows.reduce((n, h) => n + h.recoveredExpected, 0));
  const expected = money(rows.reduce((n, h) => n + h.expected, 0));
  const revenue = money(expected + recoveries);
  const total = money(rows.reduce((n, h) => n + h.food, 0) + base.other);
  const paid = money(
    s.expensePayments
      .filter((p) => p.status !== "void" && day(p.paidAt).slice(0, 7) === month)
      .reduce((sum, p) => sum + Number(p.amount), 0),
  );
  const plannedPayments = money(base.other + base.purchases);
  const paidBy = { inventory: 0, salary: 0, other: 0 };
  for (const p of s.expensePayments.filter(
    (p) => p.status !== "void" && day(p.paidAt).slice(0, 7) === month,
  )) {
    const source = s.expenses.find((e) => e.id === p.expenseId);
    const category =
      p.cashCategory ||
      cashCategory({
        ...source,
        ...p,
        expenseKind:
          source && isFeedPurchase(s, source)
            ? "feed_purchase"
            : p.expenseKind || source?.expenseKind,
      });
    paidBy[
      category === "inventory"
        ? "inventory"
        : category === "salary"
          ? "salary"
          : "other"
    ] += Number(p.amount || 0);
  }
  const outstanding = money(rows.reduce((n, h) => n + h.outstanding, 0));
  return {
    month,
    expected,
    recoveries,
    revenue,
    collected: base.collected,
    feeding: money(rows.reduce((n, h) => n + h.food, 0)),
    other: base.other,
    unallocatedOperating: money(
      base.other - rows.reduce((sum, h) => sum + h.other, 0),
    ),
    total,
    purchases: base.purchases,
    plannedPayments,
    fundingBalance: money(revenue - plannedPayments),
    paid,
    inventoryPaid: money(paidBy.inventory),
    salaryPaid: money(paidBy.salary),
    otherPaid: money(paidBy.other),
    operatingBalance: money(revenue - total),
    cashBalance: money(base.collected - paid),
    outstanding,
    debtCount: rows.filter((h) => h.outstanding > 0).length,
    lossCount: rows.filter((h) => h.active && !h.privateHorse && h.margin < 0)
      .length,
    incompleteCount: rows.filter((h) => h.active && !h.complete).length,
    expensePaymentCount: s.expensePayments.filter(
      (p) => p.status !== "void" && day(p.paidAt).slice(0, 7) === month,
    ).length,
    unpaidExpenseCount: s.expenses.filter(
      (e) =>
        !coveredFeedPlan(s, e, month) &&
        monthlyExpense(e, month) > expensePaid(s, e.id, month),
    ).length,
    horses: rows,
  };
}
