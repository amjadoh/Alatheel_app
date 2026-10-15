/** Shared, deterministic rules; the server is the authority for every write. */
import { feedingMeasure, expenseFeedMeal } from "./feeding";
import { monthlyExpense } from "./estimates";
import { expensePaid, financialSummary } from "./finance";
import { businessDay } from "./dates";
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
  const s = structuredClone(input),
    d = c.data ?? {},
    today = businessDay(now);
  let ownerId: string | undefined;
  const id = c.id || c.requestId;
  // The activity document is also the idempotency receipt, created in the same transaction.
  if (s.activities.some((x) => x.id === c.requestId && x.performedBy === a.uid))
    return s;
  if (!["request.create", "request.accept", "profile.save"].includes(c.action))
    ensure(staff(a), "هذه العملية متاحة للإدارة والموظف فقط");
  switch (c.action) {
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
      ensure(
        ["boarding", "boarding_breeding", "private"].includes(d.status),
        "حالة الخيل غير صحيحة",
      );
      const feeding = (d.feeding ?? []).map((f: any) => {
        find(s, "mealTypes", f.mealTypeId);
        return {
          mealTypeId: f.mealTypeId,
          quantity: num(f.quantity, "كمية التغذية", 0.01),
        };
      });
      ensure(feeding.length <= 20, "الحد الأقصى 20 نوع تغذية");
      put(s, "horses", {
        ...old,
        id,
        name: required(d.name, "اسم الخيل"),
        ownerId: owner.id,
        ownerName: owner.displayName,
        registrationNum: text(d.registrationNum),
        entryDate: date(d.entryDate),
        dueDate: d.status === "private" ? "" : date(d.dueDate),
        status: d.status,
        boardingFee: num(d.boardingFee, "الرسوم"),
        feeding,
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
      const measure = feedingMeasure({ ...old, ...d });
      put(s, "mealTypes", {
        id,
        name: required(d.name, "اسم الصنف"),
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
      const balance = money(
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
      ensure(
        !old || !s.expensePayments.some((p) => p.expenseId === id),
        "المصروف مرتبط بسداد؛ أنشئ مصروفًا جديدًا للتغييرات",
      );
      ensure(
        !old?.collectedHorseIds?.length,
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
      ensure(
        !s.expensePayments.some((p) => p.expenseId === id),
        "المصروف مرتبط بسجلات سداد ولا يمكن حذفه",
      );
      ensure(
        !find(s, "expenses", id).collectedHorseIds?.length,
        "المصروف مرتبط بتحصيل ولا يمكن حذفه",
      );
      s.expenses = s.expenses.filter((e) => e.id !== id);
      break;
    case "expense.pay": {
      const e = find(s, "expenses", id);
      const period = required(d.period, "شهر المصروف");
      const planned = monthlyExpense(e, period);
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
      ensure(paidAt <= today, "لا يمكن تسجيل سداد بتاريخ مستقبلي");
      e.lockedForPayments = true;
      s.expensePayments.push({
        id: c.requestId,
        expenseId: e.id,
        expenseName: e.name,
        amount,
        period,
        paidAt,
        expenseKind: e.expenseKind || "operating",
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
        basis: "current_program_full_month",
        createdAt: now,
        createdBy: a.uid,
      });
      break;
    }
    case "income.collect": {
      const h = find(s, "horses", id);
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
