import { accountingView, boundedExpense } from './accounting-boundary';
import { money, shares } from "./domain";
import type { State, Row } from "./domain";
import { feedingMeasure, feedingUnitPrice, expenseFeedMeal, feedingAtDate, feedingOnDate, feedingSkipped, horsePresentOn } from "./feeding";
import { businessDay } from "./dates";
import { stayDays } from "./boarding";
import { receiptCash } from "./receipt-cash";

export function isFeedPurchase(s: State, e: Row) {
  return e.expenseKind === "feed_purchase" || !!expenseFeedMeal(e, s.mealTypes);
}
export function coveredFeedPlan(s: State, e: Row, month: string) {
  const meal = expenseFeedMeal(e, s.mealTypes);
  return (
    !!meal &&
    e.frequency !== "once" &&
    s.expenses.some(
      (x) =>
        x.stockTransactionId &&
        x.mealTypeId === meal.id &&
        (x.costPeriod || businessDay(x.incurredAt).slice(0, 7)) === month,
    )
  );
}

export function monthDays(month: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("الشهر غير صحيح");
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function monthlyExpense(e: Row, month: string) {
  const days = monthDays(month),
    cost = Number(e.cost || 0);
  const bound=boundedExpense(e,month,days);
  if(bound.blocked) return 0;
  if (e.startMonth && e.startMonth > month) return 0;
  if (e.frequency === "once")
    return (e.costPeriod || businessDay(e.incurredAt || e.createdAt).slice(0, 7)) === month && (!e.accountingStartDate || businessDay(e.incurredAt || e.createdAt)>=e.accountingStartDate)
      ? money(cost)
      : 0;
  return money(
    cost *
      (e.frequency === "daily"
        ? bound.days
        : e.frequency === "weekly"
          ? bound.days / 7
          : bound.days / days),
  );
}

export const expenseIsShared = (e: Row) =>
  e.allocationScope === "all_active" || !e.horseIds?.length;

export function expenseShares(s: State, e: Row, month: string) {
  s=accountingView(s);
  if (
    !expenseIsShared(e) &&
    e.frequency === "once" &&
    Object.keys(e.allocations || {}).length
  )
    return monthlyExpense(e, month)
      ? (e.allocations as Record<string, number>)
      : {};
  const targets = expenseIsShared(e)
    ? s.horses
        .filter(
          (h) =>
            stayDays(h, month) > 0 && (h.status !== "archived" || !!h.exitDate),
        )
        .map((h) => h.id)
    : [...new Set<string>(e.horseIds)].filter((id) =>
        s.horses.some((h) => h.id === id),
      );
  return targets.length ? shares(monthlyExpense(e, month), targets.sort()) : {};
}

function feedingItems(s: State, h: Row, month: string) {
  const groups = new Map<string, any>(), days = monthDays(month);
  for (let i = 1; i <= days; i++) {
    const day = `${month}-${String(i).padStart(2, "0")}`;
    if (!horsePresentOn(h, day)) continue;
    for (const f of feedingAtDate(h, day)) {
      if (feedingSkipped(h, f.mealTypeId, day)) continue;
      const monthly = f.frequency === "monthly", legacy = monthly && !f.schedule?.length;
      if (!legacy && !feedingOnDate(f, day)) continue;
      const meal = s.mealTypes.find(m => m.id === f.mealTypeId), rate = meal ? feedingUnitPrice(meal) : 0;
      const key = JSON.stringify([f.mealTypeId, f.quantity, f.frequency || "daily", rate, legacy]);
      const item = groups.get(key) || { name: meal?.name || "صنف غير متاح", unit: meal ? feedingMeasure(meal).unit : "وحدة", quantity: Number(f.quantity), frequency: f.frequency || "daily", count: 0, rate, estimatedSchedule: legacy };
      item.count += legacy ? Number(f.timesPerMonth) / days : 1;
      groups.set(key, item);
    }
  }
  return [...groups.values()].map(f => ({ ...f, count: Math.round(f.count * 1e8) / 1e8, amount: money(f.quantity * f.rate * f.count) }));
}

export function horseCost(s: State, h: Row, month: string) {
  s=accountingView(s); h=s.horses.find(x=>x.id===h.id)||h;
  const period = s.financialPeriods?.find((p) => p.id === month && p.closed);
  if (period) {
    const f = period.summary.horses.find((r: Row) => r.id === h.id);
    return {
      food: Number(f?.food || 0),
      other: Number(f?.other || 0),
      total: Number(f?.total || 0),
      days: Number(f?.days || 0),
      foodItems: (f?.foodItems || []) as any[],
      expenseItems: (f?.expenseItems || []) as {
        name: string;
        frequency: string;
        shared: boolean;
        monthlyTotal: number;
        amount: number;
      }[],
      missingFeed: (f?.missing || []) as string[],
    };
  }
  const days = stayDays(h, month);
  const foodItems = feedingItems(s, h, month);
  const expenseItems = s.expenses
    .filter((e) => !isFeedPurchase(s, e))
    .map((e) => ({
      name: e.name,
      frequency: e.frequency,
      shared: expenseIsShared(e),
      monthlyTotal: monthlyExpense(e, month),
      amount: expenseShares(s, e, month)[h.id] || 0,
    }))
    .filter((e) => e.amount !== 0);
  const missingFeed = [
    ...new Set(
      s.expenses
        .filter(
          (e) =>
            isFeedPurchase(s, e) &&
            monthlyExpense(e, month) > 0 &&
            (expenseIsShared(e)
              ? h.status !== "archived"
              : e.horseIds?.includes(h.id)),
        )
        .map((e) => expenseFeedMeal(e, s.mealTypes))
        .filter(
          (m) =>
            m &&
            !h.feeding?.some(
              (f: any) => f.mealTypeId === m.id && Number(f.quantity) > 0,
            ),
        )
        .map((m) => m!.name as string),
    ),
  ];
  const food = money(
    foodItems.reduce((sum: number, f: any) => sum + f.amount, 0),
  );
  const other = money(expenseItems.reduce((sum, e) => sum + e.amount, 0));
  return {
    food,
    other,
    total: money(food + other),
    days,
    foodItems,
    expenseItems,
    missingFeed,
  };
}

export function costs(s: State, month: string) {
  s=accountingView(s);
  const closed = s.financialPeriods?.find((p) => p.id === month && p.closed);
  if (closed) {
    const f = closed.summary;
    return {
      feeding: Number(f.feeding),
      other: Number(f.other),
      total: Number(f.total),
      collected: Number(f.collected),
      expected: Number(f.expected),
      balance: money(f.collected - f.total),
      purchases: Number(f.purchases),
    };
  }
  const active = s.horses.filter((h) => h.status !== "archived");
  const feeding = money(
    s.horses.reduce(
      (sum, h) =>
        sum +
        money(
          feedingItems(s, h, month).reduce(
            (subtotal: number, f: any) => subtotal + f.amount,
            0,
          ),
        ),
      0,
    ),
  );
  const other = money(
    s.expenses
      .filter((e) => !isFeedPurchase(s, e))
      .reduce((sum, e) => sum + monthlyExpense(e, month), 0),
  );
  // A recurring feed budget is covered by actual purchase invoices for that item.
  // Count the higher of the budget and invoices, never both on top of each other.
  const purchaseGroups = new Map<string, { plan: number; invoices: number }>();
  for (const e of s.expenses.filter((e) => isFeedPurchase(s, e) && !e.purchaseAdjustment)) {
    const key = expenseFeedMeal(e, s.mealTypes)?.id || e.id,
      g = purchaseGroups.get(key) || { plan: 0, invoices: 0 };
    if (e.frequency === "once") g.invoices += monthlyExpense(e, month);
    else g.plan += monthlyExpense(e, month);
    purchaseGroups.set(key, g);
  }
  const purchases = money(
    s.expenses.filter(e => e.purchaseAdjustment === true).reduce((n,e)=>n+monthlyExpense(e,month),0) + [...purchaseGroups.values()].reduce(
      (n, g) => n + Math.max(g.plan, g.invoices),
      0,
    ),
  );
  const collected = money(
    receiptCash(s)
      .filter(
        (i) =>
          i.status !== "pending" &&
          i.status !== "void" &&
          businessDay(i.collectedAt).slice(0, 7) === month,
      )
      .reduce((sum, i) => sum + Number(i.amount || 0), 0),
  );
  const expected = money(
    active
      .filter((h) => ["boarding", "boarding_breeding"].includes(h.status))
      .reduce((sum, h) => sum + Number(h.boardingFee || 0), 0),
  );
  return {
    feeding,
    other,
    total: money(feeding + other),
    collected,
    expected,
    balance: money(collected - feeding - other),
    purchases,
  };
}
