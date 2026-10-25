/** Shared, deterministic rules; the server is the authority for every write. */
import { feedingMeasure, expenseFeedMeal, validateFeedingSchedule, addFeedingDays,
  previousFeedingDay, stockPrecision, feedingAtDate, feedingOnDate,
  feedingSkipped, horsePresentOn } from "./feeding";
import { consumeScheduledFeeding, hasPendingFeeding, reverseFeedingPortions } from "./feeding-stock";
import { monthlyExpense } from "./estimates";
import {
  expensePaid,
  expensePlan,
  expensePeriodState,
  financialSummary,
  cashCategory,
} from "./finance";
import { businessDay } from "./dates";
import { horseAccount, planPayment, accountRevision, isReceipt, preserveAccountCharges, refreshAccountBalance } from "./accounts";
import {
  financialActions,
  closePeriods,
  refreshPeriod,
  assertOpenPeriod,
} from "./periods";
import { boardingTerms } from "./boarding";
import { itemKey, similarItems } from "./inventory";
export type Role = "admin" | "employee" | "owner" | "viewer";
export type Row = { id: string; [key: string]: any };
export const collections = [
  "users",
  "owners",
  "horses",
  "registrationRequests",
  "mealTypes",
  "inventoryTransactions",
  "expenses",
  "expensePayments",
  "financialReports",
  "financialPeriods",
  "income",
  "activities",
  "settings",
] as const;
export type Collection = (typeof collections)[number];
export type State = Record<Collection, Row[]>;
export type Actor = {
  uid: string;
  role: Role;
  displayName: string;
  disabled?: boolean;
  ownerRecordId?: string;
  photoURL?: string;
  dataReady?: boolean;
};
export type Command = {
  action: string;
  id?: string;
  data?: Record<string, any>;
  requestId: string;
};
export const emptyState = (): State => ({
  users: [],
  owners: [],
  horses: [],
  registrationRequests: [],
  mealTypes: [],
  inventoryTransactions: [],
  expenses: [],
  expensePayments: [],
  financialReports: [],
  financialPeriods: [],
  income: [],
  activities: [],
  settings: [],
});
export const staff = (a: Actor) => a.role === "admin" || a.role === "employee";
export function ensure(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
const text = (v: unknown, max = 500) =>
  String(v ?? "")
    .trim()
    .slice(0, max);
const required = (v: unknown, label: string) => {
  const s = text(v);
  ensure(s, `أكمل ${label}`);
  return s;
};
function horsePhoto(value: unknown) {
  const image = String(value || "").trim();
  ensure(
    image.length <= 260000 &&
      (!image ||
        /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(image) ||
        /^https:\/\/[^\s]+$/.test(image)),
    "صورة الخيل غير صالحة أو حجمها كبير",
  );
  return image;
}
const num = (v: unknown, label: string, min = 0) => {
  const n = Number(v);
  ensure(
    v !== "" &&
      v !== null &&
      v !== undefined &&
      Number.isFinite(n) &&
      n >= min &&
      n <= 1e9,
    `قيمة ${label} غير صحيحة`,
  );
  return n;
};
export const money = (n: number) =>
  Math.round((n + Number.EPSILON) * 100) / 100;
export function date(value: unknown) {
  const s = String(value ?? "");
  ensure(
    /^\d{4}-\d{2}-\d{2}$/.test(s) &&
      new Date(s + "T12:00:00Z").toISOString().slice(0, 10) === s,
    "التاريخ غير صحيح",
  );
  return s;
}
export function nextMonth(value: string) {
  date(value);
  const [y, m, d] = value.split("-").map(Number);
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(d, last))).toISOString().slice(0, 10);
}
function find(s: State, c: Collection, id?: string) {
  const r = s[c].find((x) => x.id === id);
  ensure(r, "السجل غير موجود");
  return r;
}
function put(s: State, c: Collection, row: Row) {
  const n = s[c].findIndex((x) => x.id === row.id);
  if (n < 0) s[c].push(row);
  else s[c][n] = row;
}
export function shares(cost: number, ids: string[]) {
  const cents = Math.round(cost * 100),
    base = Math.floor(cents / ids.length);
  return Object.fromEntries(
    ids.map((id, i) => [id, (base + (i < cents % ids.length ? 1 : 0)) / 100]),
  );
}
export function bill(s: State, h: Row) {
  const extras = s.expenses.filter(
    (e) =>
      e.frequency === "once" &&
      e.allocations &&
      e.allocations[h.id] !== undefined &&
      !e.collectedHorseIds?.includes(h.id),
  );
  return {
    extras,
    amount: money(
      Number(h.boardingFee || 0) +
        extras.reduce((n, e) => n + e.allocations[h.id], 0),
    ),
  };
}
export function visibleState(s: State, a: Actor): State {
  if (staff(a))
    return {
      ...s,
      users: a.role === "admin" ? s.users : s.users.filter((u) => !u.disabled),
    };
  return {
    ...emptyState(),
    users: s.users.filter((u) => u.id === a.uid),
    horses: s.horses.filter((h) => h.ownerId === (a.ownerRecordId || a.uid)),
    registrationRequests: s.registrationRequests.filter(
      (r) => r.ownerId === (a.ownerRecordId || a.uid),
    ),
    income: s.income.filter((i) => i.ownerId === (a.ownerRecordId || a.uid)),
    activities: s.activities.filter(
      (l) => l.ownerId === (a.ownerRecordId || a.uid),
    ),
    settings: s.settings,
  };
}
export function applyCommand(
  input: State,
  a: Actor,
  c: Command,
  now = new Date().toISOString(),
): State {
  ensure(!a.disabled, "الحساب معطل");
  ensure(/^[a-zA-Z0-9_-]{6,100}$/.test(c.requestId), "معرف العملية غير صحيح");
  let s = structuredClone(input);
  const
    d = c.data ?? {},
    today = businessDay(now);
  let ownerId: string | undefined;
  const id = c.id || c.requestId;
  // The activity document is also the idempotency receipt, created in the same transaction.
  if (s.activities.some((x) => x.id === c.requestId && x.performedBy === a.uid))
    return s;
  if (!["request.create", "request.accept", "profile.save"].includes(c.action))
    ensure(staff(a), "هذه العملية متاحة للإدارة والموظف فقط");
  if (staff(a) && (financialActions.has(c.action) || c.action === "stock.move")) {
    s = consumeScheduledFeeding(s, previousFeedingDay(today), now);
    ensure(!hasPendingFeeding(s, previousFeedingDay(today)),
      "جارٍ تحديث استهلاك المخزون للفترة السابقة؛ أعد المحاولة بعد اكتمال المزامنة");
  }
  if (financialActions.has(c.action)) closePeriods(s, today);
  switch (c.action) {
    case "finance.rollover":
      break;
    case "owner.save": {
      const old = c.id ? find(s, "owners", id) : null;
      const email = text(d.email, 200).toLowerCase();
      ensure(
        !email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),
        "البريد غير صحيح",
      );
      put(s, "owners", {
        ...old,
        id,
        displayName: required(d.displayName, "اسم المالك").slice(0, 100),
        phoneNumber: text(d.phoneNumber, 30),
        email,
        notes: text(d.notes),
        createdAt: old?.createdAt ?? now,
        updatedAt: now,
      });
      // Keep current horse labels in sync; collected receipts retain their historical name.
      for (const h of s.horses.filter((h) => h.ownerId === id)) {
        h.ownerName = s.owners.find((o) => o.id === id)!.displayName;
        h.updatedAt = now;
      }
      ownerId = id;
      break;
    }
    case "request.create": {
      ensure(!staff(a), "استخدم إضافة خيل من صفحة الخيل");
      ensure(
        ["boarding", "boarding_breeding"].includes(d.requestType),
        "حدد نوع الطلب",
      );
      s.registrationRequests.push({
        id: c.requestId,
        ownerId: a.ownerRecordId || a.uid,
        ownerName: a.displayName,
        horseName: required(d.horseName, "اسم الخيل"),
        age: required(d.age, "العمر"),
        registrationNum: text(d.registrationNum),
        notes: text(d.notes),
        requestType: d.requestType,
        status: "pending",
        createdAt: now,
        updatedAt: now,
      });
      ownerId = a.ownerRecordId || a.uid;
      break;
    }
    case "request.review": {
      const r = find(s, "registrationRequests", id);
      ensure(
        ["pending", "reviewing"].includes(r.status),
        "تمت مراجعة الطلب بالفعل",
      );
      ensure(
        ["awaiting_owner_approval", "rejected"].includes(d.status),
        "حالة الطلب غير صحيحة",
      );
      Object.assign(r, {
        status: d.status,
        boardingFee: num(d.boardingFee, "رسوم الإيواء"),
        supervisorNotes: text(d.supervisorNotes),
        updatedAt: now,
      });
      ownerId = r.ownerId;
      break;
    }
    case "request.accept": {
      const r = find(s, "registrationRequests", id);
      ensure(
        r.ownerId === (a.ownerRecordId || a.uid),
        "يمكنك الموافقة على طلبك فقط",
      );
      ensure(
        r.status === "awaiting_owner_approval",
        "الطلب ليس بانتظار موافقتك",
      );
      const hid = "request_" + r.id;
      ensure(!s.horses.some((h) => h.id === hid), "الخيل مسجل بالفعل");
      s.horses.push({
        id: hid,
        name: r.horseName,
        ownerId: r.ownerId,
        ownerName: r.ownerName,
        registrationNum: r.registrationNum,
        status: r.requestType,
        boardingFee: r.boardingFee,
        entryDate: today,
        dueDate: nextMonth(today),
        feeding: [],
        notes: r.notes,
        createdAt: now,
        updatedAt: now,
      });
      Object.assign(r, { status: "approved", horseId: hid, updatedAt: now });
      ownerId = a.ownerRecordId || a.uid;
      break;
    }
    case "horse.save": {
      const old = c.id ? find(s, "horses", id) : null;
      ensure(!old || old.status !== "archived", "استعد الخيل قبل تعديله");
      const owner =
        s.owners.find((o) => o.id === d.ownerId) || find(s, "users", d.ownerId);
      ensure(!owner.disabled && !owner.deleted, "سجل المالك معطل أو محذوف");
      if (!old) assertOpenPeriod(s, date(d.entryDate));
      ensure(
        ["boarding", "boarding_breeding", "private"].includes(d.status),
        "حالة الخيل غير صحيحة",
      );
      const feeding = (d.feeding ?? []).map((f: any) => {
        find(s, "mealTypes", f.mealTypeId);
        const frequency = f.frequency || "daily";
        ensure(["daily", "monthly"].includes(frequency), "حدد تكرار التغذية");
        const timesPerMonth =
          frequency === "monthly"
            ? num(f.timesPerMonth, "عدد مرات التغذية بالشهر", 1)
            : 0;
        ensure(
          Number.isInteger(timesPerMonth) && timesPerMonth <= 1000,
          "عدد مرات التغذية يجب أن يكون عددًا صحيحًا لا يتجاوز 1000",
        );
        const schedule = frequency === "monthly"
          ? validateFeedingSchedule(f.schedule, timesPerMonth) : undefined;
        return {
          mealTypeId: f.mealTypeId,
          quantity: num(f.quantity, "كمية التغذية", 0.001),
          frequency,
          ...(frequency === "monthly" ? { timesPerMonth } : {}),
          ...(schedule ? { schedule } : {}),
        };
      });
      ensure(feeding.length <= 20, "الحد الأقصى 20 نوع تغذية");
      ensure(new Set(feeding.map((f: any) => f.mealTypeId)).size === feeding.length,
        "لا يمكن تكرار صنف التغذية لنفس الخيل");
      let feedingHistory = old?.feedingHistory;
      const historicalFeeding = feedingHistory?.length || feeding.some((f: any) => f.schedule) ||
        feeding.some((f: any) => s.mealTypes.some(m => m.id === f.mealTypeId && m.autoFeedingFrom));
      if (historicalFeeding && JSON.stringify(feeding) !== JSON.stringify(old?.feeding || [])) {
        feedingHistory = [...(old?.feedingHistory || (old ? [{ from: "0000-00-00", feeding: structuredClone(old.feeding || []), createdAt: old.createdAt || now }] : [])),
          { from: today, feeding: structuredClone(feeding), createdAt: now, requestId: c.requestId }];
        ensure(feedingHistory.length <= 1000, "سجل خطط التغذية يحتاج ترحيلًا قبل التعديل");
      }
      if (old?.accountVersion) {
        ensure(
          d.status !== "private",
          "الخيل مرتبط بكشف حساب؛ استخدم إخراج الخيل لإيقاف الإيواء مع حفظ مستحقاته",
        );
        ensure(
          d.dueDate === old.dueDate,
          "موعد الاستحقاق يحدّث من كشف الحساب بعد تسجيل الدفعات",
        );
        ensure(
          d.ownerId === old.ownerId,
          "الخيل مرتبط بكشف حساب؛ لا يمكن تغيير المالك مباشرة",
        );
        old.accountCycles = horseAccount(s, old, today)
          .items.filter((x) => x.kind === "boarding")
          .map((x) => ({
            dueDate: x.dueDate,
            amount: x.amount,
            baseFee: x.baseFee ?? boardingTerms(old, x.dueDate.slice(0, 7)).fee,
            billingPolicy:
              x.billingPolicy ||
              boardingTerms(old, x.dueDate.slice(0, 7)).policy,
          }));
      }
      const billingPolicy =
        d.billingPolicy || old?.billingPolicy || "full_month";
      ensure(
        ["full_month", "per_day"].includes(billingPolicy),
        "حدد طريقة احتساب الإيواء",
      );
      if (old && d.entryDate !== old.entryDate) {
        assertOpenPeriod(s, old.entryDate);
        ensure(
          !old.accountVersion,
          "تاريخ الدخول مرتبط بكشف الحساب ولا يمكن تغييره",
        );
      }
      const month = today.slice(0, 7),
        history = [...(old?.boardingHistory || [])];
      if (old && !history.length)
        history.push({
          month: "0000-00",
          fee: old.boardingFee || 0,
          policy: old.billingPolicy || "full_month",
        });
      const boardingHistory = history.filter((x) => x.month !== month);
      boardingHistory.push({
        month,
        fee: num(d.boardingFee, "الرسوم"),
        policy: billingPolicy,
      });
      put(s, "horses", {
        ...old,
        billingPolicy,
        boardingHistory,
        id,
        name: required(d.name, "اسم الخيل"),
        ownerId: owner.id,
        ownerName: owner.displayName,
        registrationNum: text(d.registrationNum),
        entryDate: date(d.entryDate),
        dueDate:
          d.status === "private"
            ? ""
            : !old && billingPolicy === "per_day"
              ? date(d.entryDate)
              : date(d.dueDate),
        status: d.status,
        boardingFee: num(d.boardingFee, "الرسوم"),
        feeding,
        ...(feedingHistory ? { feedingHistory } : {}),
        notes: text(d.notes),
        photoURL: horsePhoto(d.photoURL ?? old?.photoURL ?? ""),
        createdAt: old?.createdAt ?? now,
        updatedAt: now,
      });
      ownerId = owner.id;
      break;
    }
    case "horse.checkout": {
      const h = find(s, "horses", id);
      ensure(h.status !== "archived", "الخيل مؤرشف");
      ensure(
        ["customer_request", "death"].includes(d.exitReason),
        "حدد سبب الخروج",
      );
      const exit = date(d.exitDate);
      ensure(
        exit <= today && (!h.entryDate || exit >= h.entryDate),
        "الخروج يجب أن يكون بين الدخول واليوم",
      );
      assertOpenPeriod(s, exit);
      reverseFeedingPortions(s, h, day => day > exit, c.requestId, now,
        "تصحيح استهلاك بعد تاريخ خروج الخيل");
      const stays = h.stayPeriods || [{ entryDate: h.entryDate || exit }];
      ensure(!stays[stays.length - 1].exitDate, "فترة الإقامة مغلقة بالفعل");
      stays[stays.length - 1].exitDate = exit;
      h.stayPeriods = stays;
      h.previousStatus = h.status;
      Object.assign(h, {
        status: "archived",
        exitDate: date(d.exitDate),
        exitReason: d.exitReason,
        updatedAt: now,
      });
      ownerId = h.ownerId;
      break;
    }
    case "horse.restore": {
      const h = find(s, "horses", id);
      ensure(h.status === "archived", "الخيل غير مؤرشف");
      const stays = h.stayPeriods || [
        {
          entryDate: h.entryDate || businessDay(h.exitDate),
          exitDate: businessDay(h.exitDate),
        },
      ];
      ensure(
        today >= businessDay(h.exitDate),
        "تاريخ الخروج المسجل بعد اليوم؛ صحح التاريخ قبل الاستعادة",
      );
      stays.push({ entryDate: today });
      h.stayPeriods = stays;
      Object.assign(h, {
        status: h.previousStatus || "boarding",
        exitDate: null,
        exitReason: null,
        updatedAt: now,
      });
      ownerId = h.ownerId;
      break;
    }
    case "meal.save": {
      const old = c.id ? find(s, "mealTypes", id) : null;
      const name = required(d.name, "اسم الصنف");
      ensure(
        !s.mealTypes.some(
          (m) =>
            m.id !== id &&
            itemKey(m.name) === itemKey(name) &&
            itemKey(m.unit) === itemKey(d.unit),
        ),
        "هذا الصنف موجود؛ اختره ثم استخدم شراء وإضافة للمخزون",
      );
      const similar = similarItems(s.mealTypes, name, id);
      ensure(
        !similar.length || d.confirmSimilar === true,
        `يوجد صنف مشابه: ${similar.map((m) => m.name).join("، ")}. راجع الأصناف أو أكد أنه صنف مختلف`,
      );
      const measure = feedingMeasure({ ...old, ...d });
      if (old?.autoFeedingFrom) {
        const oldMeasure = feedingMeasure(old);
        ensure(d.unit === old.unit && measure.unit === oldMeasure.unit && measure.unitsPerPurchaseUnit === oldMeasure.unitsPerPurchaseUnit,
          "لا يمكن تغيير وحدة صنف مفعل للخصم التلقائي؛ أنشئ صنفًا مستقلًا للوحدة الجديدة");
      }
      put(s, "mealTypes", {
        ...old,
        id,
        name,
        unit: required(d.unit, "الوحدة"),
        pricePerUnit: num(d.pricePerUnit, "سعر الوحدة"),
        feedingUnit: d.feedingUnit
          ? required(d.feedingUnit, "وحدة التغذية")
          : measure.unit,
        feedingUnitsPerPurchaseUnit: num(
          d.feedingUnitsPerPurchaseUnit ?? measure.unitsPerPurchaseUnit,
          "عدد وحدات التغذية في وحدة الشراء",
          0.001,
        ),
        minThreshold: num(d.minThreshold, "حد التنبيه"),
        currentStock: old?.currentStock ?? num(d.currentStock, "الرصيد"),
      });
      break;
    }
    case "stock.purchase": {
      const m = find(s, "mealTypes", id),
        amount = num(d.amount, "كمية الشراء", 0.01);
      const total = money(num(d.total, "إجمالي المبلغ المدفوع", 0.01)),
        paidAt = date(d.paidAt);
      ensure(total <= 1000000, "قيمة الشراء تتجاوز حد العملية");
      ensure(paidAt <= today, "لا يمكن تسجيل شراء بتاريخ مستقبلي");
      assertOpenPeriod(s, paidAt);
      ensure(
        ["bank", "cash", "card", "other"].includes(d.method),
        "حدد طريقة الدفع",
      );
      const expenseId = c.requestId + "_purchase",
        paymentId = c.requestId + "_payment";
      ensure(
        !s.expenses.some((e) => e.id === expenseId) &&
          !s.expensePayments.some((p) => p.id === paymentId),
        "عملية الشراء مسجلة بالفعل",
      );
      m.currentStock = stockPrecision(Number(m.currentStock || 0) + amount);
      // Latest purchase rate is used only for the open month's estimate; the invoice keeps its exact total.
      m.pricePerUnit = Number((total / amount).toFixed(8));
      const purchase = {
        stockTransactionId: c.requestId,
        mealTypeId: m.id,
        mealName: m.name,
        quantity: amount,
        unit: m.unit,
        unitPrice: m.pricePerUnit,
      };
      s.expenses.push({
        id: expenseId,
        name: "شراء " + m.name,
        cost: total,
        frequency: "once",
        expenseKind: "feed_purchase",
        expenseCategory: "other",
        allocationScope: "all_active",
        chargedTo: "stable",
        horseIds: [],
        allocations: {},
        collectedHorseIds: [],
        incurredAt: paidAt,
        lockedForPayments: true,
        ...purchase,
        createdAt: now,
        updatedAt: now,
      });
      s.expensePayments.push({
        id: paymentId,
        expenseId,
        expenseName: "شراء " + m.name,
        amount: total,
        period: paidAt.slice(0, 7),
        paidAt,
        expenseKind: "feed_purchase",
        cashCategory: "inventory",
        status: "paid",
        method: d.method,
        notes: text(d.notes),
        stockTransactionId: c.requestId,
        performedBy: a.uid,
        createdAt: now,
      });
      s.inventoryTransactions.push({
        id: c.requestId,
        mealTypeId: m.id,
        mealName: m.name,
        type: "add",
        movementKind: "purchase",
        amount,
        total,
        paidAt,
        method: d.method,
        expenseId,
        paymentId,
        unitPrice: m.pricePerUnit,
        unit: m.unit,
        reason: text(d.notes) || "شراء مدفوع",
        balance: m.currentStock,
        performedBy: a.uid,
        createdAt: now,
      });
      break;
    }
    case "stock.purchase.correct": {
      ensure(a.role === "admin", "تصحيح عملية الشراء للمدير فقط");
      const original = find(s, "inventoryTransactions", id);
      ensure(original.movementKind === "purchase", "اختر عملية الشراء الأصلية من سجل المخزون");
      const currentId = original.latestCorrectionId || original.id;
      ensure(d.expectedCorrectionId === currentId, "تغيرت عملية الشراء؛ افتح سجل الحركات من جديد");
      const previous = find(s, "inventoryTransactions", currentId);
      const oldQuantity = Number(previous.correctedQuantity ?? original.amount);
      const oldTotal = Number(previous.correctedTotal ?? original.total);
      const amount = num(d.amount, "كمية الشراء الصحيحة", 0.01);
      const total = money(num(d.total, "إجمالي المبلغ الصحيح", 0.01));
      ensure(total <= 1000000, "قيمة الشراء تتجاوز حد العملية");
      const reason = required(d.reason, "سبب تصحيح الشراء");
      ensure(amount !== oldQuantity || total !== oldTotal, "لم تتغير الكمية أو المبلغ");
      const meal = find(s, "mealTypes", original.mealTypeId);
      ensure(meal.unit === original.unit, "تغيرت وحدة الصنف؛ راجع وحدة الشراء قبل التصحيح");
      const expense = find(s, "expenses", original.expenseId);
      const payment = find(s, "expensePayments", original.paymentId);
      ensure(expense.stockTransactionId === id && payment.stockTransactionId === id && payment.status === "paid", "روابط الشراء والسداد تحتاج مراجعة؛ لم يُحفظ التصحيح");
      ensure(!s.inventoryTransactions.some(t => t.id === c.requestId), "معرف التصحيح مستخدم");
      // An actual physical count supersedes every earlier quantity movement.
      const reconciled = s.inventoryTransactions.some(t => t.mealTypeId === meal.id &&
        ["reconciliation", "feeding_activation"].includes(t.movementKind) && t.createdAt >= original.createdAt);
      const quantityDelta = stockPrecision(amount - oldQuantity);
      const stockDelta = reconciled ? 0 : quantityDelta;
      const balance = stockPrecision(Number(meal.currentStock || 0) + stockDelta);
      ensure(balance >= 0, "التصحيح يجعل الرصيد سالبًا؛ طابق الموجود فعليًا أولًا ثم صحح الشراء");
      const delta = money(total - oldTotal);
      const closed = s.financialPeriods.some(p => p.id === businessDay(original.paidAt).slice(0,7) && p.closed);
      const record: Row = { id:c.requestId, mealTypeId:meal.id, mealName:meal.name,
        movementKind:"purchase_correction", type:stockDelta < 0 ? "remove" : "add", amount:Math.abs(stockDelta),
        stockDelta, quantityDelta, correctedQuantity:amount, correctedTotal:total,
        previousQuantity:oldQuantity, previousTotal:oldTotal, originalPurchaseId:id, previousCorrectionId:currentId,
        reason, performedBy:a.uid, createdAt:now, paidAt:original.paidAt, unit:original.unit,
        balance, settlementPeriod:closed ? today.slice(0,7) : businessDay(original.paidAt).slice(0,7),
        stockCountPreserved:reconciled, cashDelta:delta, closedPeriodSettlement:closed,
        previousExpense:structuredClone(expense), previousPayment:structuredClone(payment) };
      if (closed && delta !== 0) {
        const expenseId=c.requestId+"_adjustment", paymentId=c.requestId+"_payment";
        ensure(!s.expenses.some(e=>e.id===expenseId)&&!s.expensePayments.some(p=>p.id===paymentId),"التسوية مسجلة بالفعل");
        s.expenses.push({id:expenseId,name:"تسوية شراء "+meal.name,cost:delta,frequency:"once",
          incurredAt:today,expenseKind:"feed_purchase",expenseCategory:"other",allocationScope:"all_active",
          chargedTo:"stable",horseIds:[],allocations:{},collectedHorseIds:[],lockedForPayments:true,
          stockTransactionId:id,purchaseAdjustment:true,mealTypeId:meal.id,createdAt:now,updatedAt:now});
        s.expensePayments.push({id:paymentId,expenseId,expenseName:"تسوية شراء "+meal.name,amount:delta,
          paidAt:today,period:today.slice(0,7),status:"paid",method:payment.method,expenseKind:"feed_purchase",
          cashCategory:"inventory",stockTransactionId:id,purchaseAdjustment:true,notes:reason,performedBy:a.uid,createdAt:now});
        record.adjustmentExpenseId=expenseId;record.adjustmentPaymentId=paymentId;
      } else if (!closed) {
        expense.cost=total;expense.quantity=amount;expense.unitPrice=Number((total/amount).toFixed(8));expense.updatedAt=now;
        payment.amount=total;payment.correctedAt=now;payment.correctionId=c.requestId;
      }
      meal.currentStock=balance;
      const latest = s.inventoryTransactions.filter(t=>t.mealTypeId===meal.id&&t.movementKind==="purchase")
        .sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))||b.id.localeCompare(a.id))[0];
      if(latest?.id===id) meal.pricePerUnit=Number((total/amount).toFixed(8));
      original.latestCorrectionId=c.requestId;
      s.inventoryTransactions.push(record);
      break;
    }
    case "stock.reconcile": {
      const meal = find(s, "mealTypes", id);
      const actual = num(d.actualQuantity, "الكمية الفعلية");
      const reason = required(d.reason, "سبب مطابقة المخزون");
      const activating = !meal.autoFeedingFrom;
      ensure(!activating || d.activate === true,
        "أكد تفعيل الخصم التلقائي من الرصيد الفعلي");
      const before = Number(meal.currentStock || 0), delta = stockPrecision(actual - before);
      meal.currentStock = stockPrecision(actual);
      meal.autoFeedingFrom = meal.autoFeedingFrom || addFeedingDays(today, 1);
      // This count is an actual quantity now; the already elapsed part of today must not be deducted again.
      meal.autoFeedingThrough = today;
      meal.stockReconciledAt = now;
      for (const horse of s.horses.filter(h => h.feeding?.some((f: any) => f.mealTypeId === id)))
        if (!horse.feedingHistory?.length)
          horse.feedingHistory = [{ from: "0000-00-00", feeding: structuredClone(horse.feeding || []), createdAt: now }];
      s.inventoryTransactions.push({ id: c.requestId, mealTypeId: id, mealName: meal.name,
        type: delta < 0 ? "remove" : "add", movementKind: activating ? "feeding_activation" : "reconciliation",
        amount: Math.abs(delta), delta, previousBalance: before, balance: meal.currentStock,
        reason, actualQuantity: actual, performedBy: a.uid, createdAt: now });
      break;
    }
    case "feeding.skip": {
      const horse = find(s, "horses", id);
      const day = date(d.date), mealTypeId = required(d.mealTypeId, "صنف التغذية");
      assertOpenPeriod(s, day);
      ensure(day.slice(0, 7) === today.slice(0, 7), "اختر موعدًا من الشهر الحالي");
      ensure(horsePresentOn(horse, day), "الخيل غير موجود بالإسطبل في هذا الموعد");
      const plan = feedingAtDate(horse, day).find(f => f.mealTypeId === mealTypeId);
      ensure(plan && feedingOnDate(plan, day), "لا توجد وجبة مجدولة لهذا الصنف في الموعد المحدد");
      ensure(!feedingSkipped(horse, mealTypeId, day), "تم تخطي هذه الوجبة بالفعل");
      const reason = required(d.reason, "سبب تخطي الوجبة");
      horse.feedingSkips = [...(horse.feedingSkips || []),
        { id: c.requestId, date: day, mealTypeId, reason, performedBy: a.uid, createdAt: now }];
      ensure(horse.feedingSkips.length <= 1000, "سجل استثناءات التغذية يحتاج ترحيلًا قبل المتابعة");
      reverseFeedingPortions(s, horse, date => date === day, c.requestId, now, reason, mealTypeId);
      break;
    }
    case "meal.delete":
      ensure(
        !s.horses.some((h) => h.feeding?.some((f: any) => f.mealTypeId === id)),
        "الصنف مرتبط بتغذية خيل",
      );
      ensure(
        find(s, "mealTypes", id).currentStock === 0,
        "يجب تصفير رصيد الصنف بحركة موثقة قبل الحذف",
      );
      s.mealTypes = s.mealTypes.filter((x) => x.id !== id);
      break;
    case "stock.move": {
      const m = find(s, "mealTypes", id),
        amount = num(d.amount, "الكمية", 0.01);
      ensure(["add", "remove"].includes(d.type), "حدد نوع الحركة");
      const balance = stockPrecision(
        m.currentStock + (d.type === "add" ? amount : -amount),
      );
      ensure(balance >= 0, "الكمية تتجاوز الرصيد المتاح");
      m.currentStock = balance;
      s.inventoryTransactions.push({
        id: c.requestId,
        mealTypeId: id,
        mealName: m.name,
        type: d.type,
        amount,
        reason: text(d.reason),
        balance,
        performedBy: a.uid,
        createdAt: now,
      });
      break;
    }
    case "expense.save": {
      const old = c.id ? find(s, "expenses", id) : null;
      if (old?.frequency === "once")
        assertOpenPeriod(s, businessDay(old.incurredAt || old.createdAt));
      if (d.frequency === "once")
        assertOpenPeriod(
          s,
          date(
            d.incurredAt ||
              old?.incurredAt ||
              businessDay(old?.createdAt) ||
              today,
          ),
        );
      ensure(
        !old || !s.expensePayments.some((p) => p.expenseId === id),
        "المصروف مرتبط بسداد؛ أنشئ مصروفًا جديدًا للتغييرات",
      );
      ensure(
        !old?.collectedHorseIds?.length && !old?.lockedForReceipts,
        "لا يمكن تعديل مصروف تم تحصيل جزء منه",
      );
      ensure(
        ["once", "daily", "weekly", "monthly"].includes(d.frequency),
        "حدد التكرار",
      );
      const allocationScope =
        d.allocationScope || (d.horseIds?.length ? "selected" : "all_active");
      ensure(
        ["all_active", "selected"].includes(allocationScope),
        "حدد طريقة توزيع المصروف",
      );
      const ids =
        allocationScope === "all_active"
          ? []
          : [...new Set<string>(d.horseIds ?? [])];
      ensure(
        allocationScope !== "selected" || ids.length,
        "اختر الخيل المرتبطة بالمصروف",
      );
      ids.forEach((i) => find(s, "horses", i));
      const cost = num(d.cost, "التكلفة");
      const expenseCategory =
        d.expenseCategory ||
        old?.expenseCategory ||
        (cashCategory({ ...d, expenseKind: "operating" }) === "salary"
          ? "salary"
          : "other");
      ensure(
        ["salary", "other"].includes(expenseCategory),
        "حدد تصنيف المصروف",
      );
      const matchedFeed = expenseFeedMeal(d, s.mealTypes);
      const expenseKind =
        d.expenseKind || (matchedFeed ? "feed_purchase" : "operating");
      ensure(
        ["operating", "feed_purchase"].includes(expenseKind),
        "حدد نوع المصروف",
      );
      ensure(
        expenseKind !== "feed_purchase" || matchedFeed,
        "اختر صنف العلف المرتبط بالمشتريات",
      );
      const chargedTo =
        d.chargedTo ||
        (d.frequency === "once" && ids.length && expenseKind === "operating"
          ? "owner"
          : "stable");
      const startMonth = d.startMonth || old?.startMonth || "";
      if (startMonth) monthlyExpense({ id: "validation", cost: 0 }, startMonth);
      ensure(["stable", "owner"].includes(chargedTo), "حدد من يتحمل المصروف");
      ensure(
        chargedTo !== "owner" ||
          ids.every((i) => {
            const horse = find(s, "horses", i);
            return (
              horse.status !== "private" &&
              !(
                horse.status === "archived" &&
                horse.previousStatus === "private"
              )
            );
          }),
        "مصروفات الخيل الملك الخاص على الإسطبل ولا تُضاف على المالك",
      );
      ensure(
        chargedTo !== "owner" ||
          (d.frequency === "once" && ids.length && expenseKind === "operating"),
        "المصروف المسترد من المالك يجب أن يكون تشغيلًا لمرة واحدة على خيل محددة",
      );
      put(s, "expenses", {
        id,
        name: required(d.name, "اسم المصروف"),
        cost,
        frequency: d.frequency,
        allocationScope,
        expenseKind,
        expenseCategory,
        chargedTo,
        startMonth,
        incurredAt:
          d.frequency === "once"
            ? date(
                d.incurredAt ||
                  old?.incurredAt ||
                  businessDay(old?.createdAt) ||
                  today,
              )
            : "",
        ...(matchedFeed ? { mealTypeId: matchedFeed.id } : {}),
        horseIds: ids,
        allocations: chargedTo === "owner" ? shares(cost, ids) : {},
        collectedHorseIds: [],
        createdAt: old?.createdAt ?? now,
        updatedAt: now,
      });
      break;
    }
    case "expense.delete":
      ensure(a.role === "admin", "حذف المصروف للمدير فقط");
      if (find(s, "expenses", id).frequency === "once")
        assertOpenPeriod(
          s,
          businessDay(
            find(s, "expenses", id).incurredAt ||
              find(s, "expenses", id).createdAt,
          ),
        );
      ensure(
        !s.expensePayments.some((p) => p.expenseId === id),
        "المصروف مرتبط بسجلات سداد ولا يمكن حذفه",
      );
      ensure(
        !find(s, "expenses", id).collectedHorseIds?.length &&
          !find(s, "expenses", id).lockedForReceipts,
        "المصروف مرتبط بتحصيل ولا يمكن حذفه",
      );
      s.expenses = s.expenses.filter((e) => e.id !== id);
      break;
    case "expense.pay": {
      const period = required(d.period, "شهر المصروف");
      const definitions = expensePeriodState(s, period);
      const e = find(definitions, "expenses", id);
      const meal = expenseFeedMeal(e, definitions.mealTypes);
      ensure(
        !(
          meal &&
          e.frequency !== "once" &&
          definitions.expenses.some(
            (x) =>
              x.stockTransactionId &&
              x.mealTypeId === meal.id &&
              businessDay(x.incurredAt).slice(0, 7) === d.period,
          )
        ),
        "شراء هذا الصنف يسجل ويسدد من المخزون؛ لا تسدد خطة الشراء مرة ثانية",
      );
      const planned = expensePlan(s, e, period);
      const remaining = money(planned - expensePaid(s, e.id, period));
      ensure(remaining > 0, "هذا المصروف مسدد بالكامل لهذه الفترة");
      ensure(
        remaining === Number(d.expectedRemaining),
        "تغير المبلغ المتبقي؛ حدّث الشاشة قبل السداد",
      );
      const amount = money(num(d.amount, "المبلغ المدفوع", 0.01));
      ensure(
        amount <= remaining,
        "المبلغ يتجاوز المتبقي لهذه الفترة؛ سجل التكلفة الإضافية كمصروف مستقل",
      );
      const paidAt = date(d.paidAt);
      assertOpenPeriod(s, paidAt);
      ensure(paidAt <= today, "لا يمكن تسجيل سداد بتاريخ مستقبلي");
      const currentExpense = s.expenses.find((x) => x.id === id);
      if (currentExpense) currentExpense.lockedForPayments = true;
      s.expensePayments.push({
        id: c.requestId,
        expenseId: e.id,
        expenseName: e.name,
        amount,
        period,
        paidAt,
        expenseKind: meal ? "feed_purchase" : e.expenseKind || "operating",
        cashCategory: cashCategory({
          ...e,
          expenseKind: meal ? "feed_purchase" : e.expenseKind,
        }),
        status: "paid",
        notes: text(d.notes),
        performedBy: a.uid,
        createdAt: now,
      });
      break;
    }
    case "expense.payment.void": {
      ensure(a.role === "admin", "إلغاء السداد للمدير فقط");
      const p = find(s, "expensePayments", id);
      ensure(
        !p.stockTransactionId,
        "سداد شراء المخزون مرتبط بفاتورته وحركته؛ لا يلغى من سداد المصروفات",
      );
      assertOpenPeriod(s, businessDay(p.paidAt));
      ensure(p.status !== "void", "تم إلغاء السداد سابقًا");
      p.status = "void";
      p.voidReason = required(d.reason, "سبب الإلغاء");
      p.voidedAt = now;
      p.voidedBy = a.uid;
      break;
    }
    case "finance.snapshot": {
      ensure(a.role === "admin", "حفظ التقرير المالي للمدير فقط");
      const month = required(d.month, "الشهر");
      monthlyExpense({ id: "validation", cost: 0 }, month);
      ensure(
        !s.financialReports.some((r) => r.id === month),
        "يوجد تقرير محفوظ لهذا الشهر",
      );
      const summaryText = JSON.stringify(financialSummary(s, month));
      ensure(
        new TextEncoder().encode(summaryText).length < 750000,
        "التقرير أكبر من حد الحفظ؛ استخدم تصدير Excel",
      );
      s.financialReports.push({
        id: month,
        month,
        summary: JSON.parse(summaryText),
        basis: "month_configuration_and_stays",
        createdAt: now,
        createdBy: a.uid,
      });
      break;
    }
    case "income.void": {
      ensure(a.role === "admin", "إلغاء دفعة المالك للمدير فقط");
      const receipt = find(s, "income", id);
      ensure(isReceipt(receipt), "الدفعة ملغاة أو سبق تصحيحها");
      const h = find(s, "horses", receipt.horseId);
      ensure(d.expectedRevision === accountRevision(s, h), "تغير كشف الحساب؛ حدّث الشاشة قبل إلغاء الدفعة");
      const reason = required(d.reason, "سبب الإلغاء");
      preserveAccountCharges(s, h, today);
      receipt.status = "void";
      receipt.receiptAuditLocked = true;
      receipt.changeReason = reason;
      receipt.changedAt = now;
      receipt.changedBy = a.uid;
      receipt.changedByName = a.displayName;
      if (s.financialPeriods.some(p => p.closed && p.id === businessDay(receipt.cashRecognitionAt || receipt.collectedAt).slice(0, 7)))
        receipt.reversalAt = today + "T09:00:00.000Z";
      refreshAccountBalance(s, h, today, now);
      ownerId = h.ownerId;
      break;
    }
    case "income.correct":
    case "income.pay": {
      const correcting = c.action === "income.correct";
      if (correcting) ensure(a.role === "admin", "تصحيح دفعة المالك للمدير فقط");
      const original = correcting ? find(s, "income", id) : undefined;
      if (original) ensure(isReceipt(original), "الدفعة ملغاة أو سبق تصحيحها");
      const h = find(s, "horses", original?.horseId || id);
      ensure(
        ["boarding", "boarding_breeding", "archived"].includes(h.status) &&
          h.previousStatus !== "private",
        "الخيل غير مشمول بالتحصيل",
      );
      ensure(
        d.expectedRevision === accountRevision(s, h),
        "تغير كشف الحساب؛ حدّث الشاشة قبل تسجيل الدفعة",
      );
      ensure(
        ["partial", "monthly", "arrears"].includes(d.paymentType),
        "حدد نوع الدفعة",
      );
      const paidAt = date(d.paidAt);
      const targetClosed = s.financialPeriods.some(p => p.closed && p.id === paidAt.slice(0, 7));
      if (!correcting) assertOpenPeriod(s, paidAt);
      ensure(paidAt <= today, "لا يمكن تسجيل دفعة بتاريخ مستقبلي");
      ensure(
        !h.entryDate || paidAt >= h.entryDate,
        "تاريخ التحصيل يسبق دخول الخيل",
      );
      const amount = money(num(d.amount, "المبلغ المستلم", 0.01));
      ensure(amount >= 0.01 && amount <= 1000000, "المبلغ يجب أن يكون بين هللة ومليون ريال");
      ensure(!s.income.some(r => r.id === c.requestId), "معرف الدفعة مستخدم سابقًا");
      ensure(
        ["bank", "cash", "card", "other"].includes(d.method),
        "حدد طريقة التحصيل",
      );
      ensure(
        Array.isArray(d.periods || []) && (d.periods || []).length <= 120,
        "الأشهر المحددة غير صحيحة",
      );
      if (original) {
        const reason = required(d.reason, "سبب التصحيح");
        preserveAccountCharges(s, h, today);
        original.status = "replaced";
        original.receiptAuditLocked = true;
        original.changeReason = reason;
        original.changedAt = now;
        original.changedBy = a.uid;
        original.changedByName = a.displayName;
        original.replacedBy = c.requestId;
        if (s.financialPeriods.some(p => p.closed && p.id === businessDay(original.cashRecognitionAt || original.collectedAt).slice(0, 7)))
          original.reversalAt = today + "T09:00:00.000Z";
      }
      const plan = planPayment(s, h, { ...d, amount }, today);
      if (d.paymentType === "monthly" && !correcting)
        ensure(
          plan.selectedBalance > 0 && amount === plan.selectedBalance,
          "المبلغ يجب أن يساوي المتبقي من استحقاق الشهر المحدد من تاريخ التحصيل",
        );
      if (d.paymentType === "arrears") {
        ensure(
          d.periods?.length &&
            d.periods.every(
              (m: any) =>
                typeof m === "string" &&
                /^\d{4}-(0[1-9]|1[0-2])$/.test(m) &&
                m < paidAt.slice(0, 7),
            ),
          "اختر أشهرًا سابقة لتاريخ التحصيل",
        );
        ensure(
          correcting || (plan.selectedBalance > 0 && amount <= plan.selectedBalance),
          "المبلغ يتجاوز متبقي الأشهر المحددة",
        );
      }
      ensure(h.accountAnchor || h.dueDate, "حدد موعد الاستحقاق الأول للخيل");
      h.accountAnchor = h.accountAnchor || h.dueDate;
      h.accountVersion = 1;
      h.accountCycles = plan.account.items
        .filter((x) => x.kind === "boarding")
        .map((x) => ({
          dueDate: x.dueDate,
          amount: x.amount,
          baseFee: x.baseFee ?? boardingTerms(h, x.dueDate.slice(0, 7)).fee,
          billingPolicy:
            x.billingPolicy || boardingTerms(h, x.dueDate.slice(0, 7)).policy,
        }));
      s.income.push({
        id: c.requestId,
        horseId: h.id,
        horseName: h.name,
        ownerId: h.ownerId,
        ownerName: h.ownerName || "",
        amount,
        accountVersion: 1,
        paymentType: d.paymentType,
        allocations: plan.allocations,
        advanceAmount: plan.advance,
        boardingFee: money(
          plan.allocations
            .filter((x) => x.kind === "boarding")
            .reduce((n, x) => n + x.amount, 0),
        ),
        expenseShares: plan.allocations
          .filter((x) => x.kind === "expense")
          .map((x) => ({
            expenseId: x.expenseId,
            name: x.name,
            amount: x.amount,
          })),
        dueDate: plan.allocations[0]?.dueDate || paidAt,
        collectedAt: paidAt + "T09:00:00.000Z",
        paidAt,
        method: d.method,
        notes: text(d.notes),
        status: "collected",
        month: Number(paidAt.slice(5, 7)),
        year: Number(paidAt.slice(0, 4)),
        createdAt: now,
        performedBy: a.uid,
        ...(original ? {
          correctsReceiptId: original.id,
          correctionRootId: original.correctionRootId || original.id,
          changeReason: original.changeReason,
          receiptAuditLocked: true,
          ...(targetClosed ? { cashRecognitionAt: today + "T09:00:00.000Z" } : {}),
        } : {}),
      });
      const after = horseAccount(s, h, today);
      for (const item of after.items.filter((x) => x.kind === "expense")) {
        const e = s.expenses.find((e) => e.id === item.expenseId);
        if (!e) continue;
        if (item.paid > 0) e.lockedForReceipts = true;
        if (item.remaining === 0)
          e.collectedHorseIds = [
            ...new Set([...(e.collectedHorseIds || []), h.id]),
          ];
      }
      h.accountExtras = after.items
        .filter((x) => x.kind === "expense")
        .map((x) => ({
          id: x.id,
          expenseId: x.expenseId,
          dueDate: x.dueDate,
          name: x.name,
          amount: x.amount,
        }));
      const unpaid = after.items.find(
        (x) => x.kind === "boarding" && x.remaining > 0,
      );
      const last =
        after.items.filter((x) => x.kind === "boarding").at(-1)?.dueDate ||
        h.accountAnchor;
      h.dueDate = unpaid?.dueDate || nextMonth(last);
      h.updatedAt = now;
      refreshAccountBalance(s, h, today, now);
      ownerId = h.ownerId;
      break;
    }
    case "income.collect": {
      const h = find(s, "horses", id);
      ensure(
        !h.accountVersion,
        "هذا الخيل يستخدم كشف الحساب الجديد؛ حدّث التطبيق لتسجيل الدفعات",
      );
      ensure(
        h.billingPolicy !== "per_day",
        "الخيل يحتسب بالأيام؛ استخدم كشف الحساب الجديد لتسجيل الدفعة",
      );
      ensure(
        ["boarding", "boarding_breeding"].includes(h.status),
        "الخيل غير مشمول بالتحصيل",
      );
      ensure(
        h.dueDate === d.expectedDueDate,
        "تغير موعد الاستحقاق؛ حدث الشاشة قبل التحصيل",
      );
      date(h.dueDate);
      const invoiceId = h.id + "_" + h.dueDate;
      ensure(
        !s.income.some((i) => i.id === invoiceId),
        "تم تحصيل هذه الدورة سابقًا",
      );
      const b = bill(s, h);
      ensure(
        b.amount === Number(d.expectedAmount),
        "تغير المبلغ؛ راجع تفاصيل التحصيل",
      );
      s.income.push({
        id: invoiceId,
        horseId: h.id,
        horseName: h.name,
        ownerId: h.ownerId,
        ownerName: h.ownerName,
        amount: b.amount,
        boardingFee: h.boardingFee,
        expenseShares: b.extras.map((e) => ({
          expenseId: e.id,
          name: e.name,
          amount: e.allocations[h.id],
        })),
        status: "collected",
        dueDate: h.dueDate,
        collectedAt: now,
        month: Number(today.slice(5, 7)),
        year: Number(today.slice(0, 4)),
        createdAt: now,
        performedBy: a.uid,
      });
      b.extras.forEach(
        (e) => (e.collectedHorseIds = [...(e.collectedHorseIds ?? []), h.id]),
      );
      h.dueDate = nextMonth(h.dueDate);
      h.updatedAt = now;
      ownerId = h.ownerId;
      break;
    }
    case "profile.save": {
      const u = find(s, "users", a.uid);
      u.displayName = required(d.displayName, "الاسم");
      u.phoneNumber = text(d.phoneNumber, 30);
      ownerId = a.uid;
      break;
    }
    case "settings.save":
      ensure(a.role === "admin", "الإعدادات للمدير فقط");
      put(s, "settings", {
        id: "main",
        stableName: required(d.stableName, "اسم الإسطبل"),
        phone: text(d.phone),
        address: text(d.address),
        updatedAt: now,
      });
      break;
    default:
      throw new Error("عملية غير معروفة");
  }
  if (financialActions.has(c.action)) refreshPeriod(s, today);
  s.activities.push({
    id: c.requestId,
    action: c.action,
    performedBy: a.uid,
    performedByName: a.displayName,
    ...(ownerId ? { ownerId } : {}),
    createdAt: now,
  });
  return s;
}
