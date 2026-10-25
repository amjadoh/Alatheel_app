import { date, money, type Row, type State } from "./domain";
import { horseAccount, type AccountItem } from "./accounts";
import { receiptCash, activeReceipt } from "./receipt-cash";
import { businessDay } from "./dates";
import { expensePeriodState, expensePaid, financialSummary, monthEnd } from "./finance";
import { expenseShares, isFeedPurchase, monthlyExpense } from "./estimates";
import { feedingAtDate, horsePresentOn } from "./feeding";

export type FollowUpObservation = {
  code: string;
  entity: "horse" | "meal" | "expense" | "finance";
  id: string;
  name: string;
  message: string;
};
export type CollectionFollowUp = {
  horseId: string;
  horseName: string;
  ownerName: string;
  amount: number;
  boarding: number;
  extras: number;
  oldestDueDate: string;
};
export type PayableFollowUp = {
  expenseId: string;
  name: string;
  period: string;
  planned: number;
  paid: number;
  remaining: number;
  historical: boolean;
};
const sum = (values: number[]) => money(values.reduce((total, value) => total + value, 0));
const privateHorse = (h: Row) => h.status === "private" || h.status === "archived" && h.previousStatus === "private";
const validAmount = (value: unknown) => (typeof value === "number" || typeof value === "string" && !!value.trim()) &&
  Number.isFinite(Number(value)) && Number(value) >= 0;
const validDay = (value: unknown) => {
  const day = businessDay(value);
  try { return date(day); } catch { return ""; }
};
const inRange = (value: unknown, start: string, end: string) => {
  const day = businessDay(value);
  return !!day && day >= start && day <= end;
};

/** Read-only operational view. This neither settles bills nor corrects saved data.
 * The forecast is this month's recorded cash movement if known balances settle,
 * never a bank balance, operating profit, or a promise of owner payment.
 */
export function operationalFollowUp(state: State, today: string) {
  date(today);
  const month = today.slice(0, 7), start = month + "-01", end = monthEnd(month);
  const observations: FollowUpObservation[] = [];
  const observe = (value: FollowUpObservation) => {
    if (!observations.some(item => item.code === value.code && item.entity === value.entity && item.id === value.id)) observations.push(value);
  };
  let cashComplete = true, payableAmountsComplete = true;
  const receipts = receiptCash(state).filter(receipt => {
    if (validAmount(receipt.cashAdjustment ? -Number(receipt.amount) : receipt.amount) && validDay(receipt.collectedAt)) {
      if (!receipt.horseId || !state.horses.some(horse => horse.id === receipt.horseId))
        observe({ code: "receipt_link_missing", entity: "finance", id: receipt.id, name: "تحصيل يحتاج ربطًا بكشف الحساب",
          message: "المبلغ المحصل مسجل، لكن الخيل المرتبط به غير متاح؛ راجع السجل قبل تأكيد المتبقي على الملاك" });
      return true;
    }
    cashComplete = false;
    observe({ code: "receipt_cash_incomplete", entity: "finance", id: receipt.id, name: "سجل تحصيل يحتاج مراجعة",
      message: "مبلغ التحصيل أو تاريخه غير مكتمل؛ لا يدخل هذا السجل في التوقع حتى مراجعته" });
    return false;
  });
  const payments = state.expensePayments.filter(payment => !["void", "pending"].includes(payment.status)).filter(payment => {
    if (validAmount(payment.purchaseAdjustment ? Math.abs(Number(payment.amount)) : payment.amount) && validDay(payment.paidAt)) {
      if (!payment.expenseId || !/^\d{4}-(0[1-9]|1[0-2])$/.test(String(payment.period || ""))) {
        payableAmountsComplete = false;
        observe({ code: "payment_period_missing", entity: "finance", id: payment.id, name: "سداد يحتاج ربطًا بالمصروف",
          message: "المبلغ المدفوع مسجل، لكن المصروف أو شهر السداد غير مكتمل؛ راجعه قبل تأكيد الالتزامات المتبقية" });
      }
      return true;
    }
    cashComplete = false; payableAmountsComplete = false;
    observe({ code: "payment_cash_incomplete", entity: "finance", id: payment.id, name: "سداد مصروف يحتاج مراجعة",
      message: "مبلغ السداد أو تاريخه غير مكتمل؛ لا يؤكد التوقع هذا السداد حتى مراجعته" });
    return false;
  });
  // An incomplete cash record cannot silently count as a zero payment, or settle
  // a horse's balance merely because an absent timestamp compares before today.
  const ledgerState: State = { ...state,
    income: state.income.filter(r => !activeReceipt(r) || validAmount(r.amount) && validDay(r.collectedAt)),
    expensePayments: payments };
  const collections = { dueToday: [] as CollectionFollowUp[], overdue: [] as CollectionFollowUp[], upcoming: [] as CollectionFollowUp[] };
  const receivables = { total: 0, boarding: 0, extras: 0, priorMonthArrears: 0, overdueThisMonth: 0, dueToday: 0, upcoming: 0 };
  let receivablesComplete = !observations.some(item => ["receipt_cash_incomplete", "receipt_link_missing"].includes(item.code));
  for (const horse of state.horses) {
    if (privateHorse(horse)) continue;
    if (horsePresentOn(horse, today) && (!businessDay(horse.accountAnchor || horse.dueDate) || !validAmount(horse.boardingFee))) {
      receivablesComplete = false;
      observe({ code: "boarding_terms_missing", entity: "horse", id: horse.id, name: horse.name,
        message: "تحتاج رسوم الإيواء أو بداية الاستحقاق إلى مراجعة قبل تأكيد المتوقع من المالك" });
    }
    const account = horseAccount(ledgerState, horse, today, end);
    const items = account.items.filter(item => item.remaining > 0 && Number.isFinite(item.remaining));
    if (account.items.some(item => !Number.isFinite(item.remaining))) receivablesComplete = false;
    const grouped = (selected: AccountItem[]): CollectionFollowUp => ({
      horseId: horse.id, horseName: horse.name || "خيل", ownerName: horse.ownerName || "",
      amount: sum(selected.map(item => item.remaining)),
      boarding: sum(selected.filter(item => item.kind === "boarding").map(item => item.remaining)),
      extras: sum(selected.filter(item => item.kind === "expense").map(item => item.remaining)),
      oldestDueDate: selected.map(item => item.dueDate).sort()[0] || "",
    });
    for (const [name, selected] of [
      ["dueToday", items.filter(item => item.dueDate === today)],
      ["overdue", items.filter(item => item.dueDate < today)],
      ["upcoming", items.filter(item => item.dueDate > today)],
    ] as const) if (selected.length) collections[name].push(grouped(selected));
    receivables.boarding += sum(items.filter(item => item.kind === "boarding").map(item => item.remaining));
    receivables.extras += sum(items.filter(item => item.kind === "expense").map(item => item.remaining));
    receivables.priorMonthArrears += sum(items.filter(item => item.dueDate < start).map(item => item.remaining));
    receivables.overdueThisMonth += sum(items.filter(item => item.dueDate >= start && item.dueDate < today).map(item => item.remaining));
    receivables.dueToday += sum(items.filter(item => item.dueDate === today).map(item => item.remaining));
    receivables.upcoming += sum(items.filter(item => item.dueDate > today).map(item => item.remaining));
  }
  for (const key of Object.keys(receivables) as (keyof typeof receivables)[]) receivables[key] = money(receivables[key]);
  receivables.total = money(receivables.boarding + receivables.extras);
  for (const rows of Object.values(collections)) rows.sort((a, b) => a.oldestDueDate.localeCompare(b.oldestDueDate) || a.horseId.localeCompare(b.horseId));

  for (const horse of state.horses.filter(h => horsePresentOn(h, today))) {
    const feeding = feedingAtDate(horse, today);
    if (!feeding.length) observe({ code: "feeding_missing", entity: "horse", id: horse.id, name: horse.name,
      message: "برنامج التغذية غير مسجل؛ تكلفة الخيل غير مكتملة" });
    for (const plan of feeding) {
      if (!Number.isFinite(Number(plan.quantity)) || Number(plan.quantity) <= 0)
        observe({ code: "feeding_quantity_missing", entity: "horse", id: horse.id, name: horse.name,
          message: "كمية أحد أصناف التغذية غير مسجلة أو تحتاج مراجعة" });
      const meal = state.mealTypes.find(m => m.id === plan.mealTypeId);
      if (!meal) observe({ code: "feeding_item_missing", entity: "horse", id: horse.id, name: horse.name,
        message: "برنامج التغذية مرتبط بصنف مخزون غير متاح" });
      if (plan.frequency === "monthly" && !plan.schedule?.length)
        observe({ code: "feeding_schedule_missing", entity: "horse", id: horse.id, name: horse.name,
          message: "عدد مرات التغذية مسجل دون مواعيد؛ توقع استهلاك المخزون غير مكتمل" });
    }
  }
  for (const meal of state.mealTypes) {
    if (!(Number(meal.pricePerUnit) > 0) || !Number.isFinite(Number(meal.pricePerUnit)))
      observe({ code: "feed_price_missing", entity: "meal", id: meal.id, name: meal.name,
        message: "سعر الصنف غير مسجل؛ تكلفة التغذية والشراء التقديرية غير مكتملة" });
    if (!String(meal.unit || "").trim() || meal.feedingUnit &&
        (!(Number(meal.feedingUnitsPerPurchaseUnit) > 0) || !Number.isFinite(Number(meal.feedingUnitsPerPurchaseUnit))))
      observe({ code: "feed_unit_missing", entity: "meal", id: meal.id, name: meal.name,
        message: "وحدة الصنف أو تحويلها إلى وحدة التغذية يحتاج مراجعة" });
  }
  const monthState = expensePeriodState(state, month);
  for (const expense of monthState.expenses.filter(e => !isFeedPurchase(monthState, e))) {
    if (!validAmount(expense.cost)) {
      observe({ code: "expense_cost_missing", entity: "expense", id: expense.id, name: expense.name || "مصروف",
        message: "مبلغ المصروف غير مكتمل أو يحتاج مراجعة؛ لا يمكن تأكيد الالتزام المالي" });
      continue;
    }
    const planned = monthlyExpense(expense, month);
    if (planned > 0 && sum(Object.values(expenseShares(monthState, expense, month))) < planned)
      observe({ code: "expense_unallocated", entity: "expense", id: expense.id, name: expense.name,
        message: "جزء من تكلفة المصروف غير موزع على الخيل؛ راجع نطاق التوزيع" });
    if (expense.frequency === "once" && expense.horseIds?.length && !expense.allocations)
      observe({ code: "expense_allocation_approval", entity: "expense", id: expense.id, name: expense.name,
        message: "مصروف مرتبط بخيل يحتاج اعتماد توزيعه قبل التحصيل" });
  }
  const financial = financialSummary(ledgerState, month);
  for (const horse of financial.horses.filter(h => h.active && !h.complete))
    if (!observations.some(item => item.entity === "horse" && item.id === horse.id))
      observe({ code: "horse_cost_incomplete", entity: "horse", id: horse.id, name: horse.name,
        message: horse.missing.join("، ") });

  // Later receipts/payments must not suppress today's outstanding or inflate cash.
  const paymentsThroughToday = payments.filter(payment => {
    const paidDay = businessDay(payment.paidAt);
    return payment.status !== "void" && !!paidDay && paidDay <= today;
  });
  const asOfState: State = { ...ledgerState, expensePayments: paymentsThroughToday };
  const actual = {
    collected: sum(receipts.filter(receipt => inRange(receipt.collectedAt, start, today)).map(receipt => Number(receipt.amount))),
    paid: sum(paymentsThroughToday.filter(payment => inRange(payment.paidAt, start, today)).map(payment => Number(payment.amount || 0))),
    net: 0,
  };
  actual.net = money(actual.collected - actual.paid);
  const closedPeriods = state.financialPeriods.filter(period => period.closed && period.basis && period.id < month);
  const knownPeriods = new Set([month, ...closedPeriods.map(period => period.id)]);
  // Dated once-only bills remain known liabilities even before the first saved period.
  for (const expense of state.expenses) {
    const incurred = businessDay(expense.incurredAt || expense.createdAt);
    if (expense.frequency === "once" && incurred && incurred.slice(0, 7) < month) knownPeriods.add(incurred.slice(0, 7));
  }
  const payableRows: PayableFollowUp[] = [];
  for (const period of [...knownPeriods].sort()) {
    const definitions = expensePeriodState(asOfState, period);
    const hasBasis = period === month || closedPeriods.some(saved => saved.id === period);
    for (const expense of definitions.expenses) {
      if (!hasBasis && expense.frequency !== "once") continue;
      // A recurring feed budget is not an additional supplier invoice. Recorded
      // purchase invoices and their payments remain included exactly once.
      if (isFeedPurchase(definitions, expense) && expense.frequency !== "once") continue;
      if (!validAmount(expense.purchaseAdjustment ? Math.abs(Number(expense.cost)) : expense.cost) || expense.frequency === "once" && !validDay(expense.incurredAt || expense.createdAt)) {
        payableAmountsComplete = false;
        observe({ code: "expense_cost_missing", entity: "expense", id: expense.id, name: expense.name || "مصروف",
          message: "مبلغ المصروف أو تاريخ استحقاقه غير مكتمل؛ توقع المدفوعات يحتاج مراجعة هذا السجل" });
        continue;
      }
      const planned = monthlyExpense(expense, period), paid = expensePaid(asOfState, expense.id, period);
      const remaining = money(Math.max(0, planned - paid));
      if (remaining > 0) payableRows.push({ expenseId: expense.id, name: expense.name || "مصروف", period,
        planned, paid, remaining, historical: period < month });
    }
  }
  const missingHistoricalPeriods = new Set<string>();
  for (const expense of state.expenses.filter(e => e.frequency !== "once" && !isFeedPurchase(state, e))) {
    let period = String(expense.startMonth || businessDay(expense.createdAt).slice(0, 7));
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) continue;
    let limit = 0;
    while (period < month && limit++ < 1200) {
      if (!closedPeriods.some(saved => saved.id === period)) missingHistoricalPeriods.add(period);
      const [year, number] = period.split("-").map(Number);
      period = new Date(Date.UTC(year, number, 1)).toISOString().slice(0, 7);
    }
  }
  if (missingHistoricalPeriods.size) observe({ code: "payable_history_incomplete", entity: "finance", id: month, name: "الفترات السابقة",
    message: "توجد فترات سابقة دون أساس محفوظ؛ توقع المدفوعات يشمل الالتزامات السابقة المعروفة فقط" });
  const payables = {
    total: sum(payableRows.map(row => row.remaining)),
    currentMonth: sum(payableRows.filter(row => !row.historical).map(row => row.remaining)),
    priorPeriods: sum(payableRows.filter(row => row.historical).map(row => row.remaining)),
    rows: payableRows,
  };
  const excludedFeedBudget = sum(monthState.expenses.filter(e => e.frequency !== "once" && isFeedPurchase(monthState, e) && validAmount(e.cost)).map(e => monthlyExpense(e, month)));
  return {
    today, collections,
    collectionTotals: { dueToday: sum(collections.dueToday.map(row => row.amount)), overdue: sum(collections.overdue.map(row => row.amount)), upcoming: sum(collections.upcoming.map(row => row.amount)) },
    pendingRequests: state.registrationRequests.filter(request => ["pending", "reviewing", "awaiting_owner_approval"].includes(request.status))
      .map(request => ({ id: request.id, horseName: request.horseName || "خيل", ownerName: request.ownerName || "", status: request.status })),
    observations,
    forecast: {
      month, through: today, end, actual, receivables, payables,
      projectedMovement: money(actual.net + receivables.total - payables.total),
      excludedFeedBudget,
      inventoryNeedsExcluded: true as const,
      historicalPayablesScope: "saved-periods-and-dated-bills" as const,
      missingHistoricalPeriods: [...missingHistoricalPeriods].sort(),
      cashComplete,
      receivablesComplete,
      costEstimatesComplete: financial.incompleteCount === 0 && !observations.some(item =>
        ["feed_price_missing", "feed_unit_missing", "feeding_quantity_missing", "feeding_item_missing", "expense_cost_missing"].includes(item.code)),
      payablesComplete: payableAmountsComplete && missingHistoricalPeriods.size === 0,
      complete: cashComplete && receivablesComplete && payableAmountsComplete && missingHistoricalPeriods.size === 0,
    },
  };
}

export type OperationalFollowUp = ReturnType<typeof operationalFollowUp>;
