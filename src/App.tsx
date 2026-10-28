import { MonthlyDashboard as FinancialDashboard } from './monthly-dashboard';
import { accountingStart } from '../functions/src/accounting-boundary';
import './clear-light.css';
import { TERMS } from "./terms";
import { NotificationsPanel,useStaffNotifications } from "./notifications";
import { displayAmount, displayNumber, displayQuantity, displayPrice, displayDate, displayMonth, displayDateTime, displayIdentifier } from "./format";
import { FeedingEditor, FeedingPlanSummary, feedingFormError } from "./feeding-editor";
import { feedingAtDate, feedingOnDate, feedingMeasure, feedingUnitPrice, expenseFeedMeal } from "../functions/src/feeding";
import { useEffect, useMemo, useRef, useState, ReactNode } from "react";
import { inventoryNeeds } from "../functions/src/inventory-needs";
import { InventoryDashboard, InventoryItemNeeds, InventoryRunwayPanel } from "./inventory-dashboard";
import { inventoryRunway } from "../functions/src/inventory-runway";
import { operationalFollowUp } from "../functions/src/follow-up";
import { TodayActions, AccountReview, CashForecast } from "./follow-up-ui";
import {
  LayoutDashboard,
  Package,
  Wallet,
  Receipt,
  Users,
  Plus,
  ArrowUpLeft,
  Bell,
  Search,
  X,
  ChevronLeft,
  LogOut,
  ClipboardList,
  SlidersHorizontal,
  Download,
  Check,
  History,
  ShieldCheck,
  MessageSquareText,
  BookOpen,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { App as NativeApp } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import {
  connect,
  login,
  logout,
  retryLoginSession,
  execute,
  member,
  errorText,
  Actor,
  State,
  Row,
  staff,
  nextMonth,
} from "./service";
import { HorseAccount, ReceiptDetails } from "./account-ui";
import { FeedbackLauncher, FeedbackPanel } from "./feedback";
import { HelpPanel } from "./help";
import { horseAccount } from "../functions/src/accounts";
import { receiptCash } from "../functions/src/receipt-cash";
import { financialSummary } from "../functions/src/finance";
import { emptyState } from "../functions/src/domain";
import { PRIMARY_ADMIN_EMAIL } from "../functions/src/access";
import { costs, horseCost, expenseIsShared, isFeedPurchase, coveredFeedPlan } from "../functions/src/estimates";
import { exportExcel, exportPdf } from "./export";
import { UpdateButton,useAppUpdate } from "./updates";
import {
  HorseFinancialPanel,
  HorsePhoto,
} from "./finance-ui";
import {
  horseFinance,
  expensePaid,
  expensePlan,
  expensePeriodState,
} from "../functions/src/finance";
import { prepareHorsePhoto } from "./horse-photo";
import { businessDay, purchasePeriod } from "../functions/src/dates";
import type { AuthPhase } from "./auth-recovery";
import { StartupScreen } from "./startup-screen";
import { startupProgress } from "./startup-progress";
import type { StartupDataProgress } from "./startup-data";
import { similarItems } from "../functions/src/inventory";
import { stayDays } from "../functions/src/boarding";
import {
  RELEASE_VERSION,
  RELEASE_NOTES,
  needsReleaseNotes,
  markReleaseNotesRead,
} from "./release-notes";
type Field = {
  name: string;
  label: string;
  type?: string;
  required?: boolean;
  options?: [string, string][];
  min?: number;
  max?: number;
  when?: [string, string];
};
type Form = {
  title: string;
  fields: Field[];
  values: Record<string, any>;
  submit: (d: Record<string, any>) => Promise<void>;
  feeding?: boolean;
  horses?: boolean;
  horsePhoto?: boolean;
  inventoryItem?: string;
  inventoryDefinition?: boolean;
  inventoryReconciliation?: string;
  note?: string;
};
const roles: Record<string, string> = {
  admin: "مدير الإسطبل",
  employee: "موظف التشغيل",
  owner: "مالك خيل",
  viewer: "عضو جديد",
};
const status: Record<string, string> = {
  boarding: "إيواء",
  boarding_breeding: "إيواء وتشبيه",
  private: "ملك خاص",
  archived: "مؤرشف",
  pending: "قيد المراجعة",
  reviewing: "تحت الدراسة",
  awaiting_owner_approval: "بانتظار موافقتك",
  approved: "تم التسجيل",
  rejected: "مرفوض",
};
const frequencies: [string, string][] = [
  ["once", "مرة واحدة"],
  ["daily", "يومي"],
  ["weekly", "أسبوعي"],
  ["monthly", "شهري"],
];
const money = displayAmount;
const today = () => businessDay(new Date().toISOString());
const HorseIcon = ({ size = 22 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
  >
    <path d="m5 20 2-7-3-2 6-7 3 2 4-3v5c4 4 4 8 2 12M7 13h5l-2 7M10 8h.1" />
  </svg>
);
function Button({
  children,
  onClick,
  kind = "",
  disabled = false,
}: {
  children: ReactNode;
  onClick?: () => void;
  kind?: string;
  disabled?: boolean;
}) {
  return (
    <button disabled={disabled} className={`button ${kind}`} onClick={onClick}>
      {children}
    </button>
  );
}
function Empty({ text = "لا توجد سجلات بعد" }: { text?: string }) {
  return (
    <div className="empty">
      <ClipboardList />
      <p>{text}</p>
    </div>
  );
}
export default function App() {
  const [inventoryDay, setInventoryDay] = useState(today());
  useEffect(() => {
    const refresh = () => setInventoryDay(today());
    const timer = window.setInterval(refresh, 30000);
    document.addEventListener("visibilitychange", refresh);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", refresh); };
  }, []);
  const [s, setState] = useState<State>(emptyState()),
    [a, setActor] = useState<Actor | null>(null),
    [authPhase, setAuthPhase] = useState<AuthPhase>("restoring"),
    [authIssue, setAuthIssue] = useState(""),
    [startupData, setStartupData] = useState<StartupDataProgress>({ stage: "session", completed: 0, total: 0 }),
    [tab, setTab] = useState("dashboard"),
    [expenseTab, setExpenseTab] = useState("other"),
    [form, setForm] = useState<Form | null>(null),
    [detail, setDetail] = useState<{
      title: string;
      content?: ReactNode;
      horseId?: string;
    } | null>(null),
    [toast, setToast] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [search, setSearch] = useState(""),
    [archived, setArchived] = useState(false),
    [horseFilter, setHorseFilter] = useState("all"),
    [horseOwner, setHorseOwner] = useState("all"),
    [month, setMonth] = useState(today().slice(0, 7)),
    [incomeTab, setIncomeTab] = useState("pending"),
    [accountHorseId, setAccountHorseId] = useState<string | null>(null),
    [releaseOpen, setReleaseOpen] = useState(false),
    [loginOpen, setLoginOpen] = useState(false),
    [accountMenuOpen, setAccountMenuOpen] = useState(false),
    [feedbackOpen, setFeedbackOpen] = useState(false),
    [helpOpen, setHelpOpen] = useState(false),
    [online, setOnline] = useState(navigator.onLine);
  const closeRelease = () => {
    markReleaseNotesRead(localStorage);
    setReleaseOpen(false);
  };
  useEffect(() => {
    if (a?.dataReady) setReleaseOpen(needsReleaseNotes(localStorage));
    else if (!a) setReleaseOpen(false);
  }, [a?.uid, a?.dataReady]);
  const mainRef = useRef<HTMLElement>(null),
    lock = useRef(false),
    prevUid = useRef<string | null>(null);
  useEffect(
    () =>
      connect((state, actor, e, phase, progress) => {
        setState(state);
        setActor(actor);
        setAuthPhase(phase || (actor ? "ready" : "signed-out"));
        setAuthIssue(e || "");
        if (progress) setStartupData(progress);
        if (e) setError(e);
        if (actor?.uid !== prevUid.current) {
          setTab("dashboard");
          setForm(null);
          setDetail(null);
          setSearch("");
          setLoginOpen(false);
          setAccountHorseId(null);
          setAccountMenuOpen(false);
          setFeedbackOpen(false);
          setHelpOpen(false);
          prevUid.current = actor?.uid || null;
        }
      }),
    [],
  );
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 4000);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    const fn = () => setOnline(navigator.onLine);
    window.addEventListener("online", fn);
    window.addEventListener("offline", fn);
    return () => {
      window.removeEventListener("online", fn);
      window.removeEventListener("offline", fn);
    };
  }, []);
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const handle = NativeApp.addListener("backButton", () => {
      if (helpOpen) { setHelpOpen(false); return; }
      if (feedbackOpen) { if (!busy) setFeedbackOpen(false); return; }
      if (releaseOpen) closeRelease();
      else if (accountMenuOpen) setAccountMenuOpen(false);
      else if (accountHorseId) setAccountHorseId(null);
      else if (form) setForm(null);
      else if (detail) setDetail(null);
      else if (tab !== "dashboard") setTab("dashboard");
      else void NativeApp.minimizeApp();
    });
    return () => {
      void handle.then((h) => h.remove());
    };
  }, [form, detail, tab, accountHorseId, releaseOpen, accountMenuOpen, feedbackOpen, helpOpen, busy]);
  const stockNeeds = useMemo(() => inventoryNeeds(s, inventoryDay), [s, inventoryDay]);
  const followUp = useMemo(() => a?.dataReady && staff(a) ? operationalFollowUp(s, inventoryDay) : undefined, [s, inventoryDay, a?.dataReady, a?.role]);
  const stockRunway = useMemo(() => a?.dataReady && staff(a) ? inventoryRunway(s, inventoryDay) : undefined, [s, inventoryDay, a?.dataReady, a?.role]);
  const isStaff = !!a && staff(a),
    isAdmin = a?.role === "admin",
    isPrimaryAdmin = !!a?.dataReady && s.users.some(user => user.id === a.uid && String(user.email).toLowerCase() === PRIMARY_ADMIN_EMAIL),
    name = s.settings[0]?.stableName || "إسطبل الأثيل",
    active = s.horses.filter((h) => h.status !== "archived"),
    stats = costs(s, month),
    expenseState = expensePeriodState(s, month),
    expenseMonthClosed = s.financialPeriods.some(
      (p) => p.id === month && p.closed,
    ),
    expenseHorseCount = expenseState.horses.filter(
      (h) => stayDays(h, month) > 0,
    ).length,
    filtered = (rows: Row[], fields: string[]) =>
      rows.filter((r) =>
        fields.some((k) => String(r[k] || "").includes(search)),
      );
  const go = (page: string) => {
    setAccountMenuOpen(false);
    setTab(page);
    setSearch("");
    mainRef.current?.scrollTo({ top: 0 });
  };
  const visibleHorseRows = filtered(
    s.horses.filter((h) =>
      archived ? h.status === "archived" : h.status !== "archived",
    ),
    ["name", "ownerName"],
  ).filter((h) => {
    if(isStaff && horseOwner!=="all" && (horseOwner==="private" ? h.status!=="private" : h.ownerName!==horseOwner))return false;
    if (!isStaff || horseFilter === "all") return true;
    const f = horseFinance(s, h, month);
    return horseFilter === "loss"
      ? !f.privateHorse && f.margin < 0
      : horseFilter === "debt"
        ? f.outstanding > 0
        : !f.complete;
  });
  const run = async (fn: () => Promise<void>, close = true) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await fn();
      if (close) {
        setForm(null);
        setDetail(null);
      }
      setToast("تم الحفظ بنجاح");
    } catch (e) {
      setError(errorText(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const perform = (action: string, id?: string, data?: Record<string, any>) =>
    run(() => execute({ action, id, data }));
  const confirm = (
    title: string,
    description: string,
    fn: () => Promise<void>,
  ) =>
    setDetail({
      title,
      content: (
        <>
          <p>{description}</p>
          <Button kind="gold" onClick={() => void run(fn)}>
            تأكيد العملية
          </Button>
        </>
      ),
    });
  const newRequest = () =>
    setForm({
      title: "طلب تسجيل خيل",
      fields: [
        { name: "horseName", label: "اسم الخيل", required: true },
        { name: "age", label: "العمر", required: true },
        {
          name: "requestType",
          label: "نوع الخدمة",
          options: [
            ["boarding", "إيواء"],
            ["boarding_breeding", "إيواء وتشبيه"],
          ],
        },
        { name: "registrationNum", label: "رقم التسجيل" },
        { name: "notes", label: "ملاحظات", type: "textarea" },
      ],
      values: { requestType: "boarding" },
      submit: (d) => execute({ action: "request.create", data: d }),
      note: "تراجع الإدارة الطلب وترسل رسوم الإيواء. بعد موافقتك يُسجل الخيل ويظهر في حسابك.",
    });
  const ownerForm = (o?: Row) =>
    setForm({
      title: o ? "تعديل المالك" : "إضافة مالك",
      fields: [
        { name: "displayName", label: "اسم المالك", required: true },
        { name: "phoneNumber", label: "الجوال", type: "tel" },
        { name: "email", label: "البريد (اختياري)", type: "email" },
        { name: "notes", label: "ملاحظات", type: "textarea" },
      ],
      values: o || { displayName: "", phoneNumber: "", email: "", notes: "" },
      note: "سجل لإدارة الخيل والحسابات فقط. الحفظ لا ينشئ حساب دخول ولا يرسل دعوة.",
      submit: (d) => execute({ action: "owner.save", id: o?.id, data: d }),
    });
  const horseForm = (h?: Row) =>
    setForm({
      title: h ? "تعديل بيانات الخيل" : "إضافة خيل",
      fields: [
        { name: "name", label: "اسم الخيل", required: true },
        {
          name: "ownerId",
          label: "المالك",
          required: true,
          options: [
            ["", "اختر المالك"],
            ...s.owners.map((o) => [o.id, o.displayName] as [string, string]),
            ...s.users
              .filter(
                (u) =>
                  !u.disabled &&
                  !u.deleted &&
                  !u.ownerRecordId &&
                  !s.owners.some((o) => o.id === u.id),
              )
              .map(
                (u) =>
                  [u.id, `${u.displayName} (حساب مسجل)`] as [string, string],
              ),
          ],
        },
        {
          name: "status",
          label: "الحالة",
          options: [
            ["boarding", "إيواء"],
            ["boarding_breeding", "إيواء وتشبيه"],
            ["private", "ملك خاص"],
          ],
        },
        {
          name: "entryDate",
          label: "تاريخ الدخول",
          type: "date",
          required: true,
        },
        { name: "dueDate", label: "موعد الاستحقاق", type: "date" },
        {
          name: "boardingFee",
          label: "رسوم الإيواء (ر.س)",
          type: "number",
          min: 0,
          required: true,
        },
        {
          name: "billingPolicy",
          label: "احتساب الإيواء في شهر الدخول والخروج",
          options: [
            ["full_month", "شهر كامل"],
            ["per_day", "بالأيام الفعلية (رسوم الشهر ÷ أيامه × أيام الإقامة)"],
          ],
        },
        { name: "registrationNum", label: "رقم التسجيل" },
        { name: "notes", label: "ملاحظات", type: "textarea" },
      ],
      values: h
        ? { ...h, billingPolicy: h.billingPolicy || "full_month" }
        : {
            ownerId: "",
            status: "boarding",
            entryDate: today(),
            dueDate: nextMonth(today()),
            boardingFee: 0,
            billingPolicy: "full_month",
            feeding: [],
          },
      feeding: true,
      horsePhoto: true,
      note: "رسوم الإيواء شهرية؛ خيار الأيام يشمل يومي الدخول والخروج. حدد كمية التغذية ومواعيدها؛ التكلفة تراعي أيام الإقامة والمواعيد الفعلية. يبدأ خصم المخزون بعد تأكيد رصيده من المخزون. الأشهر المغلقة تحتفظ بحساباتها. الحفظ لا يرسل دعوة.",
      submit: (d) => execute({ action: "horse.save", id: h?.id, data: d }),
    });
  const mealForm = (m?: Row) =>
    setForm({
      inventoryDefinition: true,
      title: m ? "تعديل صنف" : TERMS.registerItem,
      fields: [
        { name: "name", label: "اسم الصنف", required: true },
        {
          name: "unit",
          label: "وحدة الشراء والمخزون (مثل كيس 40 كجم)",
          required: true,
        },
        {
          name: "pricePerUnit",
          label: "سعر وحدة الشراء (ر.س)",
          type: "number",
          min: 0,
          required: true,
        },
        {
          name: "feedingUnit",
          label: "وحدة كمية التغذية اليومية (مثل كجم أو ربطة)",
          required: true,
        },
        {
          name: "feedingUnitsPerPurchaseUnit",
          label: "كم وحدة تغذية في وحدة الشراء؟ (كيس 40 كجم = 40)",
          type: "number",
          min: 0.001,
          required: true,
        },
        {
          name: "minThreshold",
          label: "حد التنبيه",
          type: "number",
          min: 0,
          required: true,
        },
      ],
      values: m
        ? {
            ...m,
            feedingUnit: feedingMeasure(m).unit,
            feedingUnitsPerPurchaseUnit: feedingMeasure(m).unitsPerPurchaseUnit,
          }
        : {
            unit: "كجم",
            feedingUnit: "كجم",
            feedingUnitsPerPurchaseUnit: 1,
            pricePerUnit: 0,
            minThreshold: 10,
            currentStock: 0,
          },
      submit: (d) =>
        execute({
          action: "meal.save",
          id: m?.id,
          data: { ...d, currentStock: m?.currentStock || 0 },
        }),
      note: m
        ? "سعر الكيلو = سعر الكيس ÷ وزن الكيس. الرصيد وحركاته بوحدة الشراء. لمراجعة الموجود فعليًا استخدم «مطابقة الكمية الفعلية»؛ ولشراء جديد استخدم «مشتريات المخزون» من المصروفات. الخصم التلقائي لا يسجل مصروفًا ماليًا جديدًا."
        : "تعريف صنف جديد فقط؛ يبدأ برصيد صفر. لإضافة شراء مدفوع احفظ الصنف ثم اختر «مشتريات المخزون» من المصروفات. لا تنشئ نفس العلف مرة ثانية. كيس 40 كجم يحتوي 40 وحدة تغذية بالكجم.",
    });
  const purchase = (m: Row) =>
    setForm({
      title: `شراء مخزون · ${m.name}`,
      inventoryItem: m.id,
      fields: [
        {
          name: "amount",
          label: `الكمية المشتراة (${m.unit})`,
          type: "number",
          min: 0.01,
          required: true,
        },
        {
          name: "total",
          label: "إجمالي المبلغ المدفوع (ريال)",
          type: "number",
          min: 0.01,
          max: 1000000,
          required: true,
        },
        {
          name: "paidAt",
          label: "تاريخ الشراء والسداد",
          type: "date",
          required: true,
        },
        { name: "costPeriod", label: "يخص فترة", type: "month", required: true },
        {
          name: "method",
          label: TERMS.paymentMethod,
          options: [
            ["bank", "تحويل بنكي"],
            ["cash", "نقدي"],
            ["card", "شبكة"],
            ["other", "أخرى"],
          ],
        },
        { name: "notes", label: "مرجع الفاتورة أو ملاحظة", type: "textarea" },
      ],
      values: {
        amount: 1,
        total: m.pricePerUnit || "",
        paidAt: today(),
        costPeriod: purchasePeriod(today()),
        method: "bank",
        purchaseRequestId: crypto.randomUUID(),
      },
      note: "الفترة من يوم 28 إلى يوم 27 من الشهر المحدد. «يخص فترة» يحدد تكلفة الشراء، وتاريخ الدفع يحدد خروج المبلغ فعليًا. تزيد الكمية فور الحفظ ويُسجل الشراء والسداد مرة واحدة. أدخل إجمالي المدفوع للكمية كلها.",
      submit: (d) =>
        execute({
          action: "stock.purchase",
          id: m.id,
          requestId: d.purchaseRequestId,
          data: d,
        }),
    });
  const correctPurchase = (transaction: Row) => {
    const latest=s.inventoryTransactions.find(t=>t.id===(transaction.latestCorrectionId||transaction.id))!;
    setDetail(null);
    setForm({title:"تصحيح عملية الشراء",inventoryItem:transaction.mealTypeId,
      fields:[{name:"amount",label:`كمية الشراء الصحيحة (${transaction.unit})`,type:"number",min:0.01,required:true},
        {name:"total",label:"إجمالي المبلغ الصحيح (ريال)",type:"number",min:0.01,max:1000000,required:true},
        {name:"reason",label:"سبب تصحيح الشراء",type:"textarea",required:true}],
      values:{amount:latest.correctedQuantity??transaction.amount,total:latest.correctedTotal??transaction.total,
        expectedCorrectionId:latest.id,correctionRequestId:crypto.randomUUID(),reason:""},
      note:"يُحفظ الشراء الأصلي وسبب التصحيح. تُحدّث الكمية والمصروف والسداد دون تكرار. إذا تمت مطابقة فعلية بعد الشراء، تبقى الكمية المطابقة كما هي. تصحيح شهر مقفل يسجل فرق التسوية في الشهر الحالي. لا يغير التصحيح تاريخ الشراء أو طريقة سداده.",
      submit:d=>execute({action:"stock.purchase.correct",id:transaction.id,requestId:d.correctionRequestId,data:d})});
  };
  const move = (m: Row, type: string) =>
    setForm({
      title: `${type === "add" ? "تصحيح زيادة رصيد" : "صرف من"} ${m.name}`,
      fields: [
        {
          name: "amount",
          label: `الكمية (${m.unit})`,
          type: "number",
          min: 0.01,
          ...(type === "remove" ? { max: m.currentStock } : {}),
          required: true,
        },
        {
          name: "reason",
          label: "سبب الحركة",
          type: "textarea",
          required: true,
        },
      ],
      values: { amount: 1, type },
      note: `الرصيد الحالي: ${displayQuantity(m.currentStock)} ${m.unit}. هذه حركة كمية إضافية فقط دون مبلغ مدفوع؛ لا تستخدمها لوجبة خُصمت تلقائيًا. للمشتريات استخدم المصروفات ثم شراء مخزون وسداد قيمته.`,
      submit: (d) => execute({ action: "stock.move", id: m.id, data: d }),
    });
  const reconcileStock = (m: Row) =>
    setForm({
      title: m.autoFeedingFrom ? `مطابقة الكمية الفعلية · ${m.name}` : `تأكيد الرصيد وتفعيل الخصم · ${m.name}`,
      inventoryReconciliation: m.id,
      fields: [
        { name: "actualQuantity", label: `الموجود فعليًا (${m.unit})`, type: "number", min: 0, required: true },
        { name: "reason", label: "سبب المطابقة", type: "textarea", required: true },
      ],
      values: { actualQuantity: m.currentStock || 0, reason: "", activate: !m.autoFeedingFrom },
      note: m.autoFeedingFrom
        ? "أدخل الموجود أمامك الآن. يسجل التطبيق فرق الجرد فقط ويكمل الخصم من الرصيد المصحح، دون مصروف أو سداد جديد. إذا كانت الزيادة من شراء فاستخدم «مشتريات المخزون» من المصروفات."
        : "أكد الموجود أمامك الآن لبدء الخصم التلقائي من الغد حسب خطط التغذية. لا يخصم التطبيق الأيام السابقة أو تغذية اليوم مرة أخرى. هذه مطابقة كمية فقط؛ لا تسجل مصروف شراء أو دفعة مالية.",
      submit: (d) => execute({ action: "stock.reconcile", id: m.id, data: d }),
    });
  const skipFeeding = (h: Row, meal: Row) => {
    const dates = Array.from({ length: new Date(Number(month.slice(0, 4)), Number(month.slice(5)), 0).getDate() }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`)
      .filter((day) => feedingAtDate(h, day).some((plan: any) => plan.mealTypeId === meal.id && feedingOnDate(plan, day)) && !h.feedingSkips?.some((skip: any) => skip.mealTypeId === meal.id && skip.date === day));
    setDetail(null);
    setForm({
      title: `تخطي وجبة · ${h.name} · ${meal.name}`,
      fields: [
        { name: "date", label: "موعد الوجبة", required: true, options: [["", "اختر الموعد"], ...dates.map((day) => [day, displayDate(day)] as [string, string])] },
        { name: "reason", label: "سبب التخطي", type: "textarea", required: true },
      ],
      values: { mealTypeId: meal.id, date: dates.includes(today()) ? today() : "", reason: "" },
      note: "يسجل استثناء لهذه الوجبة فقط دون حركة مالية. يراعي تصحيح المخزون آخر جرد فعلي معتمد.",
      submit: (d) => execute({ action: "feeding.skip", id: h.id, data: d }),
    });
  };
  const expenseForm = (e?: Row) =>
    setForm({
      title: e ? "تعديل مصروف" : "مصروف جديد",
      fields: [
        { name: "name", label: "اسم المصروف", required: true },
        {
          name: "expenseKind",
          label: "نوع المصروف",
          options: [
            ["operating", "تشغيل (راتب، خدمات، وغيرها)"],
            ...(e
              ? [["feed_purchase", "خطة شراء علف قديمة"] as [string, string]]
              : []),
          ],
        },
        {
          name: "mealTypeId",
          label: "صنف العلف المشترى",
          required: true,
          when: ["expenseKind", "feed_purchase"],
          options: [
            ["", "اختر الصنف"],
            ...s.mealTypes.map((m) => [m.id, m.name] as [string, string]),
          ],
        },
        {
          name: "cost",
          label: "التكلفة (ر.س)",
          type: "number",
          min: 0,
          required: true,
        },
        { name: "frequency", label: "التكرار", options: frequencies },
        {
          name: "expenseCategory",
          label: "تصنيف المصروف",
          when: ["expenseKind", "operating"],
          options: [
            ["salary", "رواتب العمال"],
            ["other", "مصروفات أخرى"],
          ],
        },
        {
          name: "incurredAt",
          label: "تاريخ المصروف",
          type: "date",
          required: true,
          when: ["frequency", "once"],
        },
        {
          name: "startMonth",
          label: "بداية احتساب المصروف (للإجراء المتكرر)",
          type: "month",
        },
        {
          name: "chargedTo",
          label: "من يتحمل المصروف؟",
          when: ["frequency", "once"],
          options: [
            ["stable", "على الإسطبل"],
            ["owner", "يُسترد من المالك — مصروف لمرة واحدة على خيل محددة"],
          ],
        },
        {
          name: "allocationScope",
          label: "توزيع تكلفة المصروف",
          options: [
            ["all_active", "بالتساوي على جميع الخيل النشطة"],
            ["selected", "على خيل محددة"],
          ],
        },
      ],
      values: e
        ? {
            ...e,
            expenseCategory:
              e.expenseCategory ||
              (/راتب|رواتب|salary|payroll/i.test(e.name) ? "salary" : "other"),
            allocationScope: expenseIsShared(e) ? "all_active" : "selected",
            expenseKind: isFeedPurchase(s, e) ? "feed_purchase" : "operating",
            mealTypeId: expenseFeedMeal(e, s.mealTypes)?.id || "",
            incurredAt: e.incurredAt || businessDay(e.createdAt) || today(),
            chargedTo:
              e.chargedTo ||
              (Object.keys(e.allocations || {}).length ? "owner" : "stable"),
          }
        : {
            cost: 0,
            expenseCategory: "other",
            frequency: "monthly",
            startMonth: month,
            allocationScope: "all_active",
            expenseKind: "operating",
            chargedTo: "stable",
            incurredAt: today(),
            horseIds: [],
          },
      horses: true,
      note: "قيمة المصروف تخص التكرار المختار. اليومي × أيام الشهر، والأسبوعي × الأيام ÷ 7. الشراء لا يكرر تكلفة استهلاك العلف. الحفظ يسجل التزامًا؛ سجل سداده من المصروفات بزر «تسجيل سداد مصروف». لاسترداد مصروف من المالك، اختر تشغيلًا لمرة واحدة على خيل محددة.",
      submit: (d) =>
        execute({
          action: "expense.save",
          id: e?.id,
          data: {
            ...d,
            chargedTo: d.frequency === "once" ? d.chargedTo : "stable",
          },
        }),
    });
  const payExpense = (e: Row, period=month) => {
    const remaining =
      Math.round(
        (expensePlan(s, e, period) - expensePaid(s, e.id, period)) * 100,
      ) / 100;
    setForm({
      title: `سداد ${e.name}`,
      fields: [
        {
          name: "amount",
          label: "المبلغ المدفوع (ر.س)",
          type: "number",
          min: 0.01,
          max: remaining,
          required: true,
        },
        {
          name: "paidAt",
          label: TERMS.expensePaymentDate,
          type: "date",
          required: true,
        },
        { name: "notes", label: "ملاحظة أو مرجع السداد", type: "textarea" },
      ],
      values: {
        amount: remaining,
        paidAt: today(),
        period,
        expectedRemaining: remaining,
      },
      note: `سداد يخص مصروف ${period}. المتبقي ${money(remaining)} ريال. يظهر في الحركة النقدية حسب تاريخ سداد المصروف.`,
      submit: (d) => execute({ action: "expense.pay", id: e.id, data: d }),
    });
  };
  const memberForm = (u?: Row, o?: Row) =>
    setForm({
      title: u ? "تعديل عضو وصلاحيته" : "تسجيل عضو جديد",
      fields: [
        { name: "displayName", label: "الاسم الكامل", required: true },
        {
          name: "phoneNumber",
          label: "رقم الجوال",
          type: "tel",
          required: true,
        },
        ...(!u
          ? [
              {
                name: "email",
                label: "البريد المستخدم في Google",
                type: "email",
                required: true,
              },
            ]
          : []),
        {
          name: "role",
          label: "الصلاحية",
          options: Object.entries(roles) as [string, string][],
        },
        {
          name: "ownerRecordId",
          label: "ربط بسجل مالك (اختياري)",
          options: [
            ["", "بدون ربط"],
            ...s.owners
              .filter((x) => !x.linkedUserId || x.linkedUserId === u?.id)
              .map((x) => [x.id, x.displayName] as [string, string]),
          ],
        },
        ...(!u
          ? [
              {
                name: "sendInvitation",
                label: "دعوة بالبريد",
                options: [
                  ["no", "بدون إرسال دعوة"],
                  ["yes", "إرسال دعوة ورابط التطبيق"],
                ] as [string, string][],
              },
            ]
          : []),
      ],
      values: u || {
        role: "owner",
        ownerRecordId: o?.id || "",
        displayName: o?.displayName || "",
        phoneNumber: o?.phoneNumber || "",
        email: o?.email || "",
        sendInvitation: "no",
      },
      note: "هذه الشاشة تمنح حساب Google صلاحية الدخول. إرسال الدعوة اختياري. الربط بسجل المالك يتيح له رؤية خيله والتحصيلات السابقة. لتسجيل بياناته فقط استخدم قسم الملاك.",
      submit: (d) => member(u ? "update" : "create", u?.id, d),
    });
  // Keep only the horse identity; financial content is derived from the latest
  // ready state when displayed, never captured from a partial startup snapshot.
  const horseDetail = (h: Row) => setDetail({ title: h.name, horseId: h.id });
  const renderHorseDetail = (h: Row) => {
    const c = horseCost(s, h, month);
    const url = import.meta.env.VITE_PUBLIC_APP_URL;
    return (
        <>
          <HorsePhoto horse={h} large />
          <HorseFinancialPanel
            state={s}
            horse={h}
            month={month}
            staff={isStaff}
          />
          <dl>
            <dt>المالك</dt>
            <dd>{h.ownerName}</dd>
            <dt>الحالة</dt>
            <dd>{status[h.status] || h.status}</dd>
            <dt>التسجيل</dt>
            <dd>{displayIdentifier(h.registrationNum)}</dd>
            <dt>الدخول</dt>
            <dd>{displayDate(h.entryDate)}</dd>
            <dt>الاستحقاق</dt>
            <dd>{displayDate(h.dueDate)}</dd>
            <dt>رسوم الإيواء الحالية</dt>
            <dd>{money(h.boardingFee)} ر.س</dd>
            <dt>احتساب شهر الدخول والخروج</dt>
            <dd>
              {h.billingPolicy === "per_day"
                ? "بالأيام الفعلية شاملًا الدخول والخروج"
                : "شهر كامل"}
            </dd>
          </dl>
          {isStaff && (
            <div className="notice">
              <b>
                تكلفة {displayMonth(month)} التقديرية: {money(c.total)} ر.س
              </b>
              <p>
                التغذية: {money(c.food)} ر.س · المصروفات: {money(c.other)} ر.س
              </p>
              {c.foodItems.map((f: any, i: number) => (
                <p className="small" key={`food-${i}`}>
                  {f.name}: {displayQuantity(f.quantity)} {f.unit}
                  {f.frequency === "monthly" ? "/مرة" : "/يوم"} ×{" "}
                  {displayPrice(f.rate)} ر.س × {displayNumber(f.count)}{" "}
                  {f.frequency === "monthly" ? "مرات بالشهر" : "يومًا"} ={" "}
                  {money(f.amount)} ر.س
                </p>
              ))}
              {c.expenseItems.map((e, i) => (
                <p className="small" key={`expense-${i}`}>
                  {e.name} (
                  {frequencies.find(([k]) => k === e.frequency)?.[1] ||
                    e.frequency}
                  ): حصة الخيل {money(e.amount)} ر.س من إجمالي شهري{" "}
                  {money(e.monthlyTotal)} ر.س
                </p>
              ))}
              <small>
                تقدير أيام الإقامة؛ الشهر المغلق يستخدم بياناته المحفوظة.
                الأسبوعي محسوب بنسبة أيام الشهر ÷ 7. مشتريات العلف منفصلة لتجنب
                تكرار تكلفة الاستهلاك.
              </small>
              {c.missingFeed.map((item) => (
                <p className="small" key={item}>
                  تنبيه: توجد مشتريات «{item}» ولا توجد كمية تغذية مسجلة لهذا
                  الخيل؛ لم تُضف تكلفة استهلاكه لهذا الصنف.
                </p>
              ))}
            </div>
          )}
          <p>{h.notes || "لا توجد ملاحظات"}</p>
          {h.status !== "private" && h.previousStatus !== "private" && (
            <Button kind="outline" onClick={() => collect(h)}>
              كشف حساب الخيل ودفعات المالك
            </Button>
          )}
          <h3>برنامج التغذية الحالي</h3>
          {h.feeding?.length ? h.feeding.map((f:any,i:number)=>{const meal=s.mealTypes.find(m=>m.id===f.mealTypeId)||{id:f.mealTypeId,name:"صنف تغذية"};return <div key={i}><FeedingPlanSummary plan={f} meal={meal} month={month}/>{isStaff && <button className="button outline" onClick={()=>skipFeeding(h,meal)}>تخطي وجبة</button>}</div>;}) : <p className="muted">لم يحدد برنامج تغذية</p>}
          <div className="qr">
            <QRCodeSVG
              value={
                url
                  ? `${url.replace(/\/$/, "")}/?horse=${encodeURIComponent(h.id)}`
                  : `Alatheel:horse:${h.id}`
              }
              size={150}
            />
            <small>
              {url ? "رابط ملف الخيل؛ يتطلب تسجيل الدخول" : "معرف الخيل"}
            </small>
          </div>
          {isStaff && (
            <div className="actions">
              {["boarding", "boarding_breeding"].includes(h.status) && (
                <Button kind="gold" onClick={() => collect(h)}>
                  تسجيل تحصيل
                </Button>
              )}
              {h.status !== "archived" && (
                <Button
                  kind="outline"
                  onClick={() => {
                    setDetail(null);
                    setForm({
                      title: `مصروف خاص · ${h.name}`,
                      fields: [
                        { name: "name", label: "اسم المصروف", required: true },
                        {
                          name: "cost",
                          label: "التكلفة (ر.س)",
                          type: "number",
                          min: 0.01,
                          required: true,
                        },
                        {
                          name: "chargedTo",
                          label: "من يتحمله؟",
                          options:
                            h.status === "private"
                              ? [["stable", "الإسطبل"]]
                              : [
                                  ["stable", "الإسطبل"],
                                  ["owner", "يُسترد من المالك"],
                                ],
                        },
                      ],
                      values: {
                        frequency: "once",
                        expenseKind: "operating",
                        allocationScope: "selected",
                        horseIds: [h.id],
                        chargedTo: "stable",
                      },
                      note:
                        h.status === "private"
                          ? "مصروف هذا الخيل على الإسطبل. سجل سداد المصروف عند دفعه فعليًا."
                          : "يسجل تكلفة خاصة بهذا الخيل. سداد المصروف يسجل من المصروفات. لا يضاف إلى حساب المالك إلا عند اختيار استرداده منه.",
                      submit: (d) =>
                        execute({ action: "expense.save", data: d }),
                    });
                  }}
                >
                  إضافة مصروف
                </Button>
              )}
              <Button
                onClick={() => {
                  setDetail(null);
                  horseForm(h);
                }}
              >
                تعديل
              </Button>
              {h.status === "archived" ? (
                <Button onClick={() => perform("horse.restore", h.id)}>
                  استعادة الخيل
                </Button>
              ) : (
                <Button
                  kind="danger"
                  onClick={() => {
                    setDetail(null);
                    setForm({
                      title: "إخراج الخيل",
                      fields: [
                        {
                          name: "exitDate",
                          label: "تاريخ الخروج",
                          type: "date",
                          required: true,
                        },
                        {
                          name: "exitReason",
                          label: "السبب",
                          options: [
                            ["customer_request", "رغبة العميل"],
                            ["death", "وفاة"],
                          ],
                        },
                      ],
                      note: "يُحفظ التاريخ المالي للخيل. يحتسب شهر الخروج وفق سياسة الإيواء المسجلة، ويشمل الحساب بالأيام يوم الخروج. لا يمكن تغيير شهر مغلق.",
                      values: {
                        exitDate: today(),
                        exitReason: "customer_request",
                      },
                      submit: (d) =>
                        execute({
                          action: "horse.checkout",
                          id: h.id,
                          data: d,
                        }),
                    });
                  }}
                >
                  إخراج الخيل
                </Button>
              )}
            </div>
          )}
        </>
      );
  };
  useEffect(() => {
    if (!a?.dataReady || !s.horses.length) return;
    const id = new URLSearchParams(location.search).get("horse");
    if (id) {
      const h = s.horses.find((h) => h.id === id);
      if (h) {
        horseDetail(h);
        history.replaceState({}, "", location.pathname);
      }
    }
  }, [a?.uid, a?.dataReady, s.horses.length]);
  const collect = (h: Row) => {
    setDetail(null);
    setAccountHorseId(h.id);
  };
  const appUpdates=useAppUpdate();
  useEffect(() => {
    appUpdates.setPrimaryAccess(isPrimaryAdmin);
  }, [isPrimaryAdmin]);
  const detailHorse = detail?.horseId ? s.horses.find(h => h.id === detail.horseId) : undefined;
  const opening = appUpdates.blocked || appUpdates.checking || (!a && authPhase !== "signed-out") || a?.dataReady === false;
  const recordedReady = useRef(false);
  useEffect(() => {
    if (opening) { recordedReady.current = false; return; }
    if (recordedReady.current) return;
    recordedReady.current = true;
    performance.mark("alatheel:screen-ready");
    // No account or financial data enters the diagnostic startup marker.
    console.info("AlatheelStartup", JSON.stringify({ event: "screen-ready", elapsedMs: Math.round(performance.now()), screen: a ? "account" : "sign-in" }));
  }, [opening, a?.uid]);
  const notifications = useStaffNotifications(a, target => {
    setDetail(null);setAccountMenuOpen(false);
    if(target.page === "feedback"){setFeedbackOpen(true);return;}
    if(target.page === "update"){
      const channel=target.channel === "beta" ? "beta" : "stable";
      if(appUpdates.channel === channel)appUpdates.check();else appUpdates.setChannel(channel);
      go("more");return;
    }
    if(target.page === "income" && target.horseId){const horse=s.horses.find(h=>h.id===target.horseId);if(horse){go("income");collect(horse);}}
    else {go("inventory");if(target.mealTypeId)setSearch(s.mealTypes.find(m=>m.id===target.mealTypeId)?.name || "");}
  });
  const nav = isStaff
    ? [
        ["dashboard", "الرئيسية", LayoutDashboard],
        ["horses", "الخيل", HorseIcon],
        ["inventory", "المخزون", Package],
        ["income", "التحصيل", Wallet],
        ["expenses", "المصروفات", Receipt],
      ]
    : a?.role === "owner"
      ? [
          ["dashboard", "الرئيسية", LayoutDashboard],
          ["horses", "خيلي", HorseIcon],
          ["requests", "طلباتي", ClipboardList],
          ["income", "التحصيل", Wallet],
          ["more", "حسابي", Users],
        ]
      : [
          ["dashboard", "الرئيسية", LayoutDashboard],
          ["requests", "طلباتي", ClipboardList],
          ["income", "التحصيل", Wallet],
          ["more", "حسابي", Users],
        ];
  const titles: Record<string, string> = {
    dashboard: "الإسطبل في لمحة.",
    horses: isStaff ? "الخيل." : "خيلي.",
    inventory: "المخزون.",
    income: "التحصيل.",
    requests: "طلبات التسجيل.",
    expenses: "المصروفات.",
    members: "الأعضاء.",
    owners: "الملاك.",
    more: "المزيد.",
    activity: "سجل العمليات.",
    notifications: "الإشعارات.",
  };
  const pending = s.registrationRequests.filter((r) =>
    ["pending", "reviewing"].includes(r.status),
  );
  const heading = (subtitle: string, button?: ReactNode) => (
    <div className="section-heading">
      <div>
        <p className="eyebrow">{subtitle}</p>
        <h1>{titles[tab]}</h1>
      </div>
      {button}
    </div>
  );
  const searchBox = (
    <label className="search">
      <Search size={19} />
      <input
        aria-label="البحث"
        placeholder="ابحث بالاسم أو المالك…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
    </label>
  );
  if (opening) return <StartupScreen
    progress={startupProgress({
      sessionResolved: authPhase === "signed-out" || !!a || startupData.stage !== "session",
      authorized: !!a,
      verifiedVersion: appUpdates.verified && !appUpdates.checking,
      dataReady: !!a?.dataReady || authPhase === "signed-out",
      received: startupData.completed,
      expected: startupData.total,
    })}
    issue={authIssue || (authPhase === "waiting" && !online ? "تحقق من الاتصال ثم أعد المحاولة" : undefined)}
    onRetry={authIssue || authPhase === "waiting" || authPhase === "blocked" ? retryLoginSession : undefined}
    onLogout={authIssue || authPhase === "waiting" || authPhase === "blocked" ? () => void logout() : undefined}
  />;
  return (
    <div className="app clear-light" dir="rtl">
      {!online && (
        <div className="offline" role="status">
          لا يوجد اتصال. تتطلب العمليات اتصالًا؛ أعد المحاولة بعد عودته.
        </div>
      )}
      <header>
        <div className="brand">
          <img src="/logo.jpeg" alt="شعار إسطبل الأثيل" />
          <div>
            <b>{name}</b>
            <small>AL ATHEEL STUD</small>
          </div>
        </div>
        {a ? (
          <div className="header-actions">
            <button
              className="icon-button"
              aria-label="التنبيهات"
              onClick={() => go("notifications")}
            >
              <Bell size={21} />
              {notifications.unread > 0 && isStaff && <i />}
            </button>
            <button
              className="account-menu-toggle"
              aria-label={`حساب ${a.displayName}، افتح المزيد`}
              aria-expanded={accountMenuOpen}
              onClick={() => setAccountMenuOpen(!accountMenuOpen)}
            >
              <span className="account-avatar">
                <span>{a.displayName.trim().charAt(0)}</span>
                {/^https:\/\//.test(a.photoURL || "") && (
                  <img
                    src={a.photoURL}
                    alt=""
                    referrerPolicy="no-referrer"
                    onError={(e) => {
                      e.currentTarget.hidden = true;
                    }}
                  />
                )}
              </span>
              <span className="account-short-name">
                {a.displayName.trim().split(/\s+/)[0]}
              </span>
            </button>
          </div>
        ) : authPhase==="signed-out" ? (
          <button className="header-login" onClick={() => setLoginOpen(true)}>
            دخول الأعضاء <ArrowUpLeft size={16} />
          </button>
        ) : <span className="muted small">استعادة الحساب</span>}
      </header>
      {accountMenuOpen && a && (
        <>
          <button
            className="account-menu-backdrop"
            aria-label="إغلاق قائمة الحساب"
            onClick={() => setAccountMenuOpen(false)}
          />
          <nav className="account-popover" aria-label="المزيد وخيارات الحساب" onKeyDown={e=>{if(e.key==="Escape")setAccountMenuOpen(false);}}>
            <div className="account-menu-profile"><span className="account-profile-avatar">{a.photoURL ? <img src={a.photoURL} alt="" referrerPolicy="no-referrer"/> : a.displayName.charAt(0)}</span><div><strong><bdi dir="auto">{a.displayName}</bdi></strong><small>{roles[a.role]}</small></div><button className="account-close" aria-label="إغلاق القائمة" onClick={()=>setAccountMenuOpen(false)}><X size={18}/></button></div>
            <button onClick={()=>{setAccountMenuOpen(false);setHelpOpen(true);}}><BookOpen size={18}/><span>التعليمات</span><ChevronLeft size={16}/></button>
            {isStaff && <button onClick={()=>go("owners")}><Users size={18}/><span>سجل الملاك</span><ChevronLeft size={16}/></button>}
            {isStaff && <button onClick={()=>go("requests")}><ClipboardList size={18}/><span>طلبات تسجيل الخيل</span><ChevronLeft size={16}/></button>}
            {isAdmin && <button onClick={()=>go("members")}><Users size={18}/><span>الأعضاء والصلاحيات</span><ChevronLeft size={16}/></button>}
            {isAdmin && <button onClick={()=>{setAccountMenuOpen(false);setFeedbackOpen(true);}}><MessageSquareText size={18}/><span>بلاغات التطبيق</span><ChevronLeft size={16}/></button>}
            <button onClick={()=>go("notifications")}><Bell size={18}/><span>الإشعارات</span><ChevronLeft size={16}/></button>
            <button onClick={()=>go("activity")}><History size={18}/><span>سجل العمليات</span><ChevronLeft size={16}/></button>
            <button onClick={()=>go("more")}><SlidersHorizontal size={18}/><span>بيانات حسابي والإعدادات</span><ChevronLeft size={16}/></button>
            <p className="session-note"><ShieldCheck size={16}/>جلسة الدخول محفوظة {displayNumber(7)} أيام</p>
            <button onClick={()=>void logout()}><LogOut size={18}/><span>تسجيل الخروج</span><ChevronLeft size={16}/></button>
          </nav>
        </>
      )}
      <main ref={mainRef}>
        {!a && authPhase!=="signed-out" ? (
          <section className="card session-restoring" dir="rtl" role="status" aria-live="polite">
            <ShieldCheck size={28}/>
            <h1>{authPhase==="blocked"?"تعذر فتح الحساب":"جارٍ استعادة حسابك…"}</h1>
            {authPhase==="waiting" && <p>ننتظر الاتصال للتحقق من جلستك المحفوظة.</p>}
            {(authPhase==="waiting"||authPhase==="blocked") && <>
              {authIssue && <p className="notice error">{authIssue}</p>}
              <button className="button gold" onClick={()=>retryLoginSession()}>إعادة المحاولة</button>
              <button className="button" onClick={()=>void logout()}>تسجيل الخروج</button>
            </>}
          </section>
        ) : !a ? (
          <>
            <div className="hero">
              <img src="/horses.jpg" alt="صورة توضيحية لخيل عربية" />
              <div className="hero-shade" />
              <span>صورة توضيحية</span>
              <div className="hero-copy">
                <p>الأصالة تُرعى هنا</p>
                <h1>
                  خيلك.
                  <br />
                  في موطنها.
                </h1>
              </div>
            </div>
            <section className="welcome">
              <p className="eyebrow">إسطبل الأثيل</p>
              <h2>رعاية تليق بالأصيل.</h2>
              <p className="muted">
                إيواء ورعاية يومية ومتابعة لخيلك، وتجربة واحدة تجمع طلباتك
                وسجلاتك وتفاصيل الإيواء.
              </p>
              <div className="services">
                {[
                  "إيواء الخيل",
                  "تغذية ورعاية",
                  "إيواء وتشبيه",
                  "متابعة المالك",
                ].map((x, i) => (
                  <div key={x}>
                    <span>0{i + 1}</span>
                    <b>{x}</b>
                  </div>
                ))}
              </div>
              <Button kind="gold" onClick={() => setLoginOpen(true)}>
                دخول الأعضاء باستخدام Google <ArrowUpLeft size={20} />
              </Button>
              <Button kind="outline" onClick={() => setLoginOpen(true)}>
                طلب تسجيل خيل
              </Button>
              <p className="muted small">
                بعد الدخول تظهر لوحة معلومات حسابك، ومنها تقدم طلب الخيل وتتابع
                اعتماد الإدارة.
              </p>
            </section>
          </>
        ) : (
          <div className="content">
            {a.dataReady === false && (
              <section className="card" role="status">
                جارٍ تحميل سجلات الإسطبل…
              </section>
            )}
            {a.dataReady !== false && tab === "dashboard" && (
              <>
                {heading("متابعة الإسطبل")}
                <label className="period">
                  الفترة{" "}
                  <input
                    type="month"
                    aria-label="شهر التقرير"
                    min={accountingStart(s).slice(0,7)||undefined}
                    value={month}
                    onChange={(e) =>
                      setMonth(e.target.value || today().slice(0, 7))
                    }
                  />
                </label>
                {isStaff && (
                  <FinancialDashboard
                    onPayExpense={(id,period)=>{const e=expensePeriodState(s,period).expenses.find(e=>e.id===id);if(e)payExpense(e,period);}}
                    state={s}
                    month={month}
                    onGo={go}
                    onHorse={horseDetail}
                    admin={isAdmin}
                    onSave={() =>
                      confirm(
                        "حفظ تقرير الشهر",
                        "يحفظ الأرقام الحالية وتفاصيل تكلفة كل خيل بتاريخ اليوم. لن تتغير هذه النسخة بتعديل الأسعار أو التسجيلات التالية. الحسابات وفق برنامج التغذية وأيام الإقامة وسياسة الإيواء المسجلة.",
                        () =>
                          execute({
                            action: "finance.snapshot",
                            data: { month },
                          }),
                      )
                    }
                  />
                )}
                {isStaff && followUp && <details className="daily-follow-up"><summary>المتابعة والمراجعة</summary>
                  <TodayActions followUp={followUp}
                    stockItems={s.mealTypes.filter(m => Number(m.currentStock) <= Number(m.minThreshold || 0) || (stockRunway?.items.some(i => i.id === m.id && !!i.needsProvidingDate && i.needsProvidingDate <= inventoryDay))).map(m => ({ id: m.id, name: m.name, message: Number(m.currentStock) <= 0 ? "الصنف نافد" : stockRunway?.items.some(i => i.id === m.id && i.needsProvidingDate === inventoryDay) ? "الكمية لا تكفي وجبات اليوم" : "وصل إلى حد التنبيه" }))}
                    onHorse={id => { const h = s.horses.find(h => h.id === id); if (h) { go("income"); collect(h); } }}
                    onInventory={id => { go("inventory"); setSearch(s.mealTypes.find(m => m.id === id)?.name || ""); }}
                    onRequests={() => go("requests")}
                  />
                  <AccountReview followUp={followUp} onObservation={observation => {
                    if (observation.entity === "horse") { const h=s.horses.find(h=>h.id===observation.id); if(h) horseForm(h); }
                    else if (observation.entity === "meal") { const m=s.mealTypes.find(m=>m.id===observation.id); if(m) mealForm(m); }
                    else if (observation.entity === "expense") { go("expenses"); setSearch(s.expenses.find(e=>e.id===observation.id)?.name || ""); }
                    else if (isStaff) setDetail({ title: observation.name || "مراجعة الحسابات", content: <>
                      <p>{observation.message}</p>
                      {observation.code === "payable_history_incomplete" && <p>الفترات التي لا تتوفر لها حسابات محفوظة تحتاج مراجعة سجلاتها قبل اعتماد أرقامها. لا يعيد التطبيق حساب هذه الفترات أو تعديلها تلقائيًا.</p>}
                    </> });
                  }} />
                  <CashForecast forecast={followUp.forecast} />
                </details>}
                {!isStaff && (
                  <>
                    <div className="dashboard-grid">
                      <button
                        className="stat dark"
                        onClick={() => go("horses")}
                      >
                        <HorseIcon />
                        <span>
                          {isStaff ? "الخيل في الإسطبل" : "خيلك المسجلة"}
                        </span>
                        <strong>{displayNumber(active.length)}</strong>
                        <small>
                          عرض التفاصيل <ArrowUpLeft size={16} />
                        </small>
                      </button>
                      <button
                        className="stat gold"
                        onClick={() => go("income")}
                      >
                        <Wallet />
                        <span>المبالغ المحصلة</span>
                        <strong>{money(stats.collected)}</strong>
                        <small>ريال سعودي · خلال الفترة</small>
                      </button>
                      <button className="stat" onClick={() => go("requests")}>
                        <ClipboardList />
                        <span>{isStaff ? "طلبات تحتاج مراجعة" : "طلباتك"}</span>
                        <strong>
                          {displayNumber(isStaff ? pending.length : s.registrationRequests.length)}
                        </strong>
                        <small>
                          متابعة التسجيل <ArrowUpLeft size={16} />
                        </small>
                      </button>
                      <button
                        className="stat"
                        onClick={() => go(isStaff ? "owners" : "income")}
                      >
                        <Users />
                        <span>
                          {isStaff ? "الملاك" : TERMS.expectedBoarding}
                        </span>
                        <strong>
                          {isStaff
                            ? new Set(active.map((h) => h.ownerId)).size
                            : money(
                                s.horses.reduce(
                                  (sum, h) =>
                                    sum + horseFinance(s, h, month).expected,
                                  0,
                                ),
                              )}
                        </strong>
                        <small>
                          {isStaff ? "أصحاب الخيل النشطة" : "ريال سعودي"}
                        </small>
                      </button>
                    </div>
                  </>
                )}
                {isStaff && (
                  <div className="operations-strip">
                    <button onClick={() => go("horses")}>
                      {displayNumber(active.length)} خيل نشطة
                    </button>
                    <button onClick={() => go("requests")}>
                      {displayNumber(pending.length)} طلبات
                    </button>
                    <button onClick={() => go("owners")}>سجل الملاك</button>
                  </div>
                )}
                <div className="section-heading compact">
                  <h2>إجراء سريع</h2>
                  <span className="muted">من هنا تبدأ</span>
                </div>
                <div className="quick-actions">
                  {isStaff ? (
                    <>
                      <Button onClick={() => horseForm()}>
                        <Plus size={18} />
                        إضافة خيل
                      </Button>
                      <Button onClick={() => go("inventory")}>
                        <Package size={18} />
                        حركة مخزون
                      </Button>
                      <Button onClick={() => go("income")}>
                        <Wallet size={18} />
                        تحصيل
                      </Button>
                    </>
                  ) : (
                    <Button kind="gold" onClick={newRequest}>
                      <Plus size={18} />
                      طلب تسجيل خيل
                    </Button>
                  )}
                </div>
                {isStaff && (
                  <>
                    <section className="card">
                      <h2>تنبيهات المخزون</h2>
                      {s.mealTypes.filter(
                        (m) => m.currentStock <= m.minThreshold,
                      ).length ? (
                        s.mealTypes
                          .filter((m) => m.currentStock <= m.minThreshold)
                          .map((m) => (
                            <button
                              key={m.id}
                              className="list-link"
                              onClick={() => go("inventory")}
                            >
                              <span>
                                {m.name}
                                <small>بلغ حد التنبيه</small>
                              </span>
                              <b className="warning">
                                {displayQuantity(m.currentStock)} {m.unit}
                              </b>
                              <ChevronLeft size={18} />
                            </button>
                          ))
                      ) : (
                        <p className="muted">الأرصدة أعلى من حدود التنبيه.</p>
                      )}
                    </section>
                  </>
                )}
                <section className="card">
                  <h2>التحصيل خلال ٦ أشهر</h2>
                  <div className="chart">
                    {Array.from({ length: 6 }, (_, i) => {
                      const d = new Date();
                      d.setMonth(d.getMonth() - (5 - i));
                      const m = d.toISOString().slice(0, 7),
                        v = financialSummary(s, m).collected,
                        max =
                          Math.max(1, ...s.income.map((x) => x.amount)) *
                          Math.max(1, s.income.length);
                      return (
                        <div key={m}>
                          <small>{money(v)}</small>
                          <i
                            style={{
                              height: Math.max(3, (v / max) * 100) + "px",
                            }}
                          />
                          <span>{m.slice(5)}</span>
                        </div>
                      );
                    })}
                  </div>
                  <p className="muted small">
                    من سجلات التحصيل الفعلية المتاحة.
                  </p>
                </section>
                <div className="actions">
                  <Button
                    kind="outline"
                    onClick={() =>
                      void run(() => exportExcel(s, month, isStaff), false)
                    }
                  >
                    <Download size={17} />
                    Excel
                  </Button>
                  <Button
                    kind="outline"
                    onClick={() => void run(() => exportPdf(s, month), false)}
                  >
                    <Download size={17} />
                    PDF
                  </Button>
                </div>
              </>
            )}
            {tab === "horses" && (
              <>
                {heading(
                  `${displayNumber(active.length)} خيل نشطة`,
                  isStaff ? (
                    <button
                      className="round-add"
                      aria-label="إضافة خيل"
                      onClick={() => horseForm()}
                    >
                      <Plus />
                    </button>
                  ) : undefined,
                )}
                {searchBox}
                {isStaff && (
                  <div className="actions">
                    <Button kind="outline" onClick={() => ownerForm()}>
                      إضافة مالك
                    </Button>
                    <Button kind="outline" onClick={() => go("owners")}>
                      سجل الملاك
                    </Button>
                  </div>
                )}
                <div className="tabs">
                  <button
                    className={!archived ? "selected" : ""}
                    onClick={() => setArchived(false)}
                  >
                    النشطة
                  </button>
                  <button
                    className={archived ? "selected" : ""}
                    onClick={() => setArchived(true)}
                  >
                    الأرشيف
                  </button>
                </div>
                <label className="period">
                  شهر الحساب{" "}
                  <input
                    type="month"
                    aria-label="شهر حساب الخيل"
                    min={accountingStart(s).slice(0,7)||undefined}
                    value={month}
                    onChange={(e) =>
                      setMonth(e.target.value || today().slice(0, 7))
                    }
                  />
                </label>
                {isStaff && (
                  <label className="field">
                    <span>عرض الخيل</span>
                    <select
                      value={horseFilter}
                      onChange={(e) => setHorseFilter(e.target.value)}
                    >
                      <option value="all">جميع الخيل</option>
                      <option value="loss">تكلفته أعلى من دخله</option>
                      <option value="debt">متبقي على المالك</option>
                      <option value="incomplete">بيانات تكلفة ناقصة</option>
                    </select>
                  </label>
                )}
                {isStaff&&<label className="field"><span>حسب المالك</span><select aria-label="حسب المالك" value={horseOwner} onChange={e=>setHorseOwner(e.target.value)}><option value="all">جميع الملاك</option><option value="private">ملك الإسطبل</option>{[...new Set(s.horses.filter(h=>h.status!=="private").map(h=>h.ownerName).filter(Boolean))].map(name=><option key={name} value={name}>{name}</option>)}</select></label>}
                {visibleHorseRows.map((h) => {
                  const f = horseFinance(s, h, month);
                  return (
                    <button
                      className="horse-card card financial-horse-card"
                      key={h.id}
                      onClick={() => horseDetail(h)}
                    >
                      <HorsePhoto horse={h} />
                      <div>
                        <div className="spread">
                          <h2>{h.name}</h2>
                          <span className="pill">
                            {status[h.status] || h.status}
                          </span>
                        </div>
                        <p>{h.ownerName}</p>
                        {isStaff && (
                          <div className="horse-finance-line">
                            {!f.privateHorse && <span>{TERMS.expectedOwnerAmount} {money(f.revenue)}</span>}
                            <span>التكلفة {money(f.total)}</span>{!f.privateHorse&&<><span>تم تحصيله {money(f.cash)}</span><span>المتبقي على المالك {money(f.outstanding)}</span></>}
                          </div>
                        )}
                        {isStaff && (
                          <p
                            className={
                              !f.privateHorse && f.margin < 0
                                ? "value-negative"
                                : !f.complete
                                  ? "value-warning"
                                  : "value-positive"
                            }
                          >
                            {f.privateHorse
                              ? "ملك الإسطبل · تكلفة فقط"
                              : f.margin < 0
                                ? `عجز ${money(Math.abs(f.margin))} ر.س${!f.complete ? " على الأقل · تكلفة ناقصة" : ""}`
                                : !f.complete
                                  ? "التكلفة غير مكتملة"
                                  : `نتيجة التشغيل المقدّرة ${money(f.margin)} ر.س`}
                          </p>
                        )}
                        <b
                          className={`small ${f.outstanding ? "value-negative" : "muted"}`}
                        >
                          متبقي على المالك {money(f.outstanding)} ر.س
                        </b>
                      </div>
                      <ChevronLeft />
                    </button>
                  );
                })}
                {!visibleHorseRows.length && (
                  <Empty text="لا توجد خيل تطابق البحث والتصفية" />
                )}
              </>
            )}
            {tab === "requests" && (
              <>
                {heading(
                  isStaff
                    ? "من الطلب إلى اعتماد المالك"
                    : "تابع رحلة تسجيل خيلك",
                  !isStaff ? (
                    <button
                      className="round-add"
                      aria-label="طلب تسجيل خيل"
                      onClick={newRequest}
                    >
                      <Plus />
                    </button>
                  ) : undefined,
                )}
                {s.registrationRequests
                  .slice()
                  .reverse()
                  .map((r) => (
                    <section className="card" key={r.id}>
                      <div className="spread">
                        <h2>{r.horseName}</h2>
                        <span
                          className={`pill ${r.status === "rejected" ? "red" : ""}`}
                        >
                          {status[r.status]}
                        </span>
                      </div>
                      <p className="muted">
                        {r.ownerName} · العمر {displayNumber(r.age)} · {status[r.requestType]}
                      </p>
                      {r.registrationNum && (
                        <p>رقم التسجيل: {displayIdentifier(r.registrationNum)}</p>
                      )}
                      {r.notes && <p>{r.notes}</p>}
                      {r.boardingFee !== undefined && (
                        <div className="big-number">
                          {money(r.boardingFee)} <small>ر.س / شهر</small>
                        </div>
                      )}
                      {r.supervisorNotes && (
                        <p className="notice">{r.supervisorNotes}</p>
                      )}
                      {isStaff &&
                        ["pending", "reviewing"].includes(r.status) && (
                          <Button
                            kind="gold"
                            onClick={() =>
                              setForm({
                                title: "مراجعة طلب " + r.horseName,
                                fields: [
                                  {
                                    name: "boardingFee",
                                    label: "رسوم الإيواء الشهرية",
                                    type: "number",
                                    min: 0,
                                    required: true,
                                  },
                                  {
                                    name: "supervisorNotes",
                                    label: "ملاحظات المشرف",
                                    type: "textarea",
                                  },
                                  {
                                    name: "status",
                                    label: "القرار",
                                    options: [
                                      [
                                        "awaiting_owner_approval",
                                        "إرسال العرض للمالك",
                                      ],
                                      ["rejected", "رفض الطلب"],
                                    ],
                                  },
                                ],
                                values: {
                                  boardingFee: 0,
                                  status: "awaiting_owner_approval",
                                },
                                submit: (d) =>
                                  execute({
                                    action: "request.review",
                                    id: r.id,
                                    data: d,
                                  }),
                              })
                            }
                          >
                            مراجعة وتحديد الرسوم
                          </Button>
                        )}
                      {!isStaff && r.status === "awaiting_owner_approval" && (
                        <Button
                          kind="gold"
                          onClick={() =>
                            confirm(
                              "الموافقة وتسجيل الخيل",
                              `توافق على رسوم إيواء ${money(r.boardingFee)} ر.س شهريًا. يبدأ الاستحقاق بعد شهر من التسجيل.`,
                              () =>
                                execute({ action: "request.accept", id: r.id }),
                            )
                          }
                        >
                          موافقة وتسجيل الخيل
                        </Button>
                      )}
                    </section>
                  ))}
                {!s.registrationRequests.length && (
                  <Empty text="ليس لديك طلبات تسجيل حتى الآن" />
                )}
              </>
            )}
            {tab === "notifications" && <NotificationsPanel notifications={notifications}/>}
            {tab === "inventory" && isStaff && (
              <>
                {heading(
                  "احتياج التغذية حتى يوم 27",
                  <button
                    className="round-add"
                    aria-label={TERMS.registerItem}
                    onClick={() => mealForm()}
                  >
                    <Plus />
                  </button>,
                )}
                <InventoryDashboard needs={stockNeeds} />
                {searchBox}
                {filtered(s.mealTypes, ["name"]).map((m) => (
                  <section className="card" key={m.id}>
                    <div className="spread">
                      <h2>{m.name}</h2>
                      <span hidden={m.currentStock>m.minThreshold && stockNeeds.items.find(i=>i.id===m.id)!.shortage<=0 && !stockNeeds.items.find(i=>i.id===m.id)!.unscheduled.length}
                        className={`pill ${m.currentStock <= m.minThreshold || stockNeeds.items.find(i => i.id === m.id)!.shortage > 0 ? "red" : ""}`}
                      >
                        {m.currentStock <= 0 ? "نافد" : stockNeeds.items.find(i => i.id === m.id)!.shortage > 0 ? "يحتاج شراء" : stockNeeds.items.find(i => i.id === m.id)!.unscheduled.length ? "مواعيد غير مكتملة" : m.currentStock <= m.minThreshold ? "منخفض" : ""}
                      </span>
                    </div>
                    <InventoryItemNeeds item={stockNeeds.items.find(i => i.id === m.id)!} end={stockNeeds.end} />
                    {stockRunway?.items.find(i => i.id === m.id) && <InventoryRunwayPanel name={m.name} item={stockRunway.items.find(i => i.id === m.id)!} today={inventoryDay} horizonEnd={stockRunway.horizonEnd} />}
                    <p className="muted">
                      حد التنبيه {displayQuantity(m.minThreshold)} · سعر وحدة الشراء{" "}
                      {displayPrice(m.pricePerUnit)} ر.س
                    </p>
                    <p className="muted small">
                      وحدة الشراء: {m.unit} · تحتوي{" "}
                      {displayQuantity(feedingMeasure(m).unitsPerPurchaseUnit)}{" "}
                      {feedingMeasure(m).unit} · سعر {feedingMeasure(m).unit}:{" "}
                      {displayPrice(feedingUnitPrice(m))} ر.س
                    </p>
                    <p className="muted small">{m.autoFeedingFrom ? <>الخصم التلقائي مفعّل من {displayDate(m.autoFeedingFrom)}</> : "الخصم التلقائي غير مفعّل؛ أكد الموجود فعليًا أولًا"}</p>
                    <div className="actions">
                      <Button kind="outline" onClick={() => reconcileStock(m)}>{m.autoFeedingFrom ? "مطابقة الكمية الفعلية" : "تأكيد الرصيد وتفعيل الخصم"}</Button>
                    </div>
                    <div className="text-actions">
                      <button onClick={() => mealForm(m)}>تعديل الصنف</button>
                      <button onClick={() => move(m, "remove")}>صرف استثنائي</button>
                      <button
                        onClick={() =>
                          setDetail({
                            title: "حركات " + m.name,
                            content: (
                              <>
                                {s.inventoryTransactions
                                  .filter((t) => t.mealTypeId === m.id)
                                  .reverse()
                                  .map((t) => (
                                    <div className="record" key={t.id}>
                                      <b>
                                        {t.movementKind === "purchase_correction" ? "تصحيح شراء" : t.movementKind === "purchase"
                                          ? "شراء مدفوع"
                                          : t.type === "add"
                                            ? "تصحيح / إضافة"
                                            : "صرف"}{" "}
                                        {displayQuantity(t.amount)}
                                      </b>
                                      <p>{t.reason || "دون ملاحظات"}</p>
                                      {t.movementKind === "purchase" && (
                                        <p>
                                          إجمالي المدفوع: {money(t.total)} ر.س ·
                                          تاريخ السداد {displayDate(t.paidAt)}
                                        </p>
                                      )}
                                      {t.movementKind === "purchase_correction" && <>
                                        <p>تصحيح شراء: من {displayQuantity(t.previousQuantity)} إلى {displayQuantity(t.correctedQuantity)} {t.unit} · من {money(t.previousTotal)} إلى {money(t.correctedTotal)} ر.س</p>
                                        <p className="small muted">شراء بتاريخ {displayDate(t.paidAt)} · {t.closedPeriodSettlement ? `تسوية في ${displayMonth(t.settlementPeriod)}` : "تم تحديث المصروف والسداد"}{t.stockCountPreserved ? " · الكمية المطابقة محفوظة" : ""}</p>
                                      </>}
                                      {t.movementKind === "purchase" && t.latestCorrectionId && <p className="small muted">سجل الشراء الأصلي محفوظ؛ راجع التصحيحات المرتبطة به.</p>}
                                      {t.movementKind === "purchase" && isAdmin && <Button kind="outline" onClick={()=>correctPurchase(t)}>تصحيح عملية الشراء</Button>}
                                      <small>
                                        {displayDateTime(t.createdAt)}{" "}
                                        · الرصيد {displayQuantity(t.balance)}
                                      </small>
                                    </div>
                                  ))}
                              </>
                            ),
                          })
                        }
                      >
                        سجل الحركات
                      </button>
                      <button
                        className="danger-text"
                        onClick={() =>
                          confirm(
                            "حذف الصنف",
                            "يمكن حذف الصنف إذا كان رصيده صفرًا وغير مرتبط ببرنامج تغذية.",
                            () => execute({ action: "meal.delete", id: m.id }),
                          )
                        }
                      >
                        حذف
                      </button>
                    </div>
                  </section>
                ))}
                {!s.mealTypes.length && <Empty />}
              </>
            )}
            {tab === "income" && (
              <>
                {heading(
                  isStaff ? "استحقاق واضح. تحصيل موثق." : "سجل إيواء خيلك",
                )}
                <div className="income-summary">
                  <span>التحصيل في {displayMonth(month)}</span>
                  <strong>
                    {money(stats.collected)} <small>ر.س</small>
                  </strong>
                </div>
                {searchBox}
                <div className="tabs">
                  <button
                    className={incomeTab === "pending" ? "selected" : ""}
                    onClick={() => setIncomeTab("pending")}
                  >
                    الاستحقاقات
                  </button>
                  <button
                    className={incomeTab === "collected" ? "selected" : ""}
                    onClick={() => setIncomeTab("collected")}
                  >
                    المحصل
                  </button>
                </div>
                {incomeTab === "pending"
                  ? filtered(
                      active.filter((h) =>
                        ["boarding", "boarding_breeding"].includes(h.status),
                      ),
                      ["name", "ownerName"],
                    ).map((h) => (
                      <section className="card" key={h.id}>
                        <div className="spread">
                          <h2>{h.name}</h2>
                          <span
                            className={`pill ${horseAccount(s, h, today()).items.some((x) => x.remaining > 0 && x.dueDate < today()) ? "red" : ""}`}
                          >
                            {horseAccount(s, h, today()).outstanding === 0
                              ? "مسدد"
                              : horseAccount(s, h, today()).items.some(
                                    (x) =>
                                      x.remaining > 0 && x.dueDate < today(),
                                  )
                                ? "متأخر"
                                : "مستحق"}
                          </span>
                        </div>
                        <p className="muted">
                          {h.ownerName} · {h.dueDate ? displayDate(h.dueDate) : "حدد تاريخ الاستحقاق"}
                        </p>
                        <div className="big-number">
                          {money(horseAccount(s, h, today()).outstanding)}{" "}
                          <small>ر.س</small>
                        </div>
                        {isStaff ? (
                          <Button
                            kind="gold"
                            disabled={!h.dueDate}
                            onClick={() => collect(h)}
                          >
                            كشف الحساب وتسجيل دفعة
                          </Button>
                        ) : (
                          <p className="muted small">
                            رسوم الإيواء؛ المصروفات الإضافية تظهر في السند بعد
                            التحصيل.
                          </p>
                        )}
                      </section>
                    ))
                  : filtered(
                      receiptCash(s).filter(
                        (i) =>
                          businessDay(i.collectedAt).slice(0, 7) === month &&
                          i.status !== "pending" &&
                          i.status !== "void",
                      ),
                      ["horseName", "ownerName"],
                    )
                      .slice()
                      .reverse()
                      .map((i) => (
                        <section className="card" key={i.id}>
                          <div className="spread">
                            <h2>{i.horseName}</h2>
                            <span className="pill">
                              <Check size={12} />
                              {i.cashAdjustment ? "تسوية تصحيح" : "محصل"}
                            </span>
                          </div>
                          <p>{i.ownerName}</p>
                          <div className="big-number">
                            {money(i.amount)} <small>ر.س</small>
                          </div>
                          <p className="muted small">
                            الاستحقاق {displayDate(i.dueDate)} · التحصيل{" "}
                            {businessDay(i.collectedAt)}
                          </p>
                          <ReceiptDetails receipt={i} />
                          {a?.role === "admin" && !i.cashAdjustment && <Button kind="outline" onClick={() => { const h = s.horses.find(h => h.id === i.horseId); if (h) collect(h); }}>كشف الحساب وتصحيح الدفعة</Button>}
                          {i.expenseShares?.map((e: any) => (
                            <p className="small" key={e.expenseId}>
                              {e.name}: {money(e.amount)} ر.س
                            </p>
                          ))}
                        </section>
                      ))}
                {incomeTab === "collected" &&
                  !receiptCash(s).some(
                    (i) =>
                      businessDay(i.collectedAt).slice(0, 7) === month &&
                      i.status !== "pending" &&
                      i.status !== "void",
                  ) && <Empty text="لا توجد عمليات تحصيل بعد" />}
              </>
            )}
            {tab === "expenses" && isStaff && (
              <>
                {heading(
                  "سجّل مصروفات التشغيل",
                  <button
                    className="round-add"
                    aria-label="إضافة مصروف"
                    hidden={expenseTab !== "other"}
                    disabled={expenseMonthClosed}
                    onClick={() => expenseForm()}
                  >
                    <Plus />
                  </button>,
                )}
                <label className="period">
                  الفترة المعروضة{" "}
                  <input
                    type="month"
                    aria-label="شهر المصروف"
                    value={month}
                    onChange={(e) =>
                      setMonth(e.target.value || today().slice(0, 7))
                    }
                  />
                </label>
                <section className="card expense-total"><span>إجمالي تكلفة الفترة</span><strong>{money(financialSummary(s,month).plannedPayments)} ر.س</strong><div className="spread small"><span>مشتريات المخزون: {money(financialSummary(s,month).purchases)} ر.س</span><span>مصروفات أخرى: {money(financialSummary(s,month).other)} ر.س</span></div></section>
                <div className="expense-tabs" role="tablist" aria-label="أنواع المصروفات">
                  <button id="expenses-other" role="tab" aria-selected={expenseTab === "other"} aria-controls="expenses-other-panel" onClick={()=>setExpenseTab("other")}>المصروفات الأخرى</button>
                  <button id="expenses-stock" role="tab" aria-selected={expenseTab === "stock"} aria-controls="expenses-stock-panel" onClick={()=>setExpenseTab("stock")}>مشتريات المخزون</button>
                </div>
                <div id="expenses-stock-panel" role="tabpanel" aria-labelledby="expenses-stock" hidden={expenseTab !== "stock"}>
                  <section className="card stock-purchase-entry"><div className="actions">{s.mealTypes.filter(m=>!m.archived).map(m=><Button key={m.id} kind="outline" onClick={()=>purchase(m)}>شراء {m.name}</Button>)}</div>{!s.mealTypes.some(m=>!m.archived)&&<p>أضف صنفًا من المخزون ليظهر زر شرائه هنا.</p>}</section>
                  <h2>عمليات الشراء المسجلة · {displayMonth(month)}</h2>
                  {s.inventoryTransactions.filter(t=>t.movementKind==="purchase"&&(t.costPeriod||businessDay(t.paidAt).slice(0,7))===month).sort((a,b)=>String(b.paidAt).localeCompare(String(a.paidAt))).map(t=>{
                    const latest=s.inventoryTransactions.find(x=>x.id===(t.latestCorrectionId||t.id))||t;
                    return <section className="card" key={t.id}>
                      <div className="spread"><h2>شراء {t.mealName}</h2><span className="pill">مسدد بالكامل</span></div>
                      <p>الكمية: {displayQuantity(latest.correctedQuantity??t.amount)} {t.unit}</p>
                      <div className="spread"><span>إجمالي المدفوع</span><b>{money(latest.correctedTotal??t.total)} ر.س</b></div>
                      <p className="muted small">تاريخ الشراء والسداد: {displayDate(t.paidAt)}</p>
                      <p className="muted small">يخص فترة: {displayMonth(t.costPeriod||businessDay(t.paidAt).slice(0,7))}{!t.costPeriod?" · سجل سابق بالتاريخ الأصلي":" · من 28 إلى 27"}</p>
                      {t.latestCorrectionId&&<p className="small">تم التصحيح؛ السجل الأصلي والسبب محفوظان في حركات المخزون.</p>}
                      {isAdmin&&<Button kind="outline" onClick={()=>correctPurchase(t)}>تصحيح عملية الشراء</Button>}
                    </section>;
                  })}
                  {!s.inventoryTransactions.some(t=>t.movementKind==="purchase"&&(t.costPeriod||businessDay(t.paidAt).slice(0,7))===month)&&<section className="card"><p>لا توجد مشتريات مسجلة لهذه الفترة.</p></section>}
                  {s.inventoryTransactions.filter(t=>t.movementKind==="purchase_correction"&&t.closedPeriodSettlement&&t.cashDelta!==0&&t.settlementPeriod===month).map(t=><section className="card" key={t.id}><h2>تسوية شراء {t.mealName}</h2><p>فرق التصحيح: {money(t.cashDelta)} ر.س</p><p className="muted small">{t.reason} · {displayDate(t.createdAt)}</p><p className="small">تسوية سجل سابق؛ لا تعني شراء كمية أو دفع مبلغ جديد.</p></section>)}
                </div>
                <div id="expenses-other-panel" role="tabpanel" aria-labelledby="expenses-other" hidden={expenseTab !== "other"}>
                {expenseMonthClosed && (
                  <p className="notice">
                    هذا الشهر محفوظ؛ تظهر تفاصيل المصروفات وقت إغلاقه. يمكن
                    تسجيل سداد المتبقي بتاريخ اليوم دون تغيير أرقام الشهر
                    المغلق.
                  </p>
                )}
                {expenseState.expenses.filter(e=>!isFeedPurchase(expenseState,e)).map((e) => (
                  <section className="card" key={e.id}>
                    <div className="spread">
                      <h2>{e.name}</h2>
                      <b>{money(e.cost)} ر.س</b>
                    </div>
                    <p className="muted">
                      {frequencies.find((f) => f[0] === e.frequency)?.[1]} ·{" "}
                      {!expenseIsShared(e)
                        ? e.horseIds
                            .map(
                              (id: string) =>
                                expenseState.horses.find((h) => h.id === id)
                                  ?.name || id,
                            )
                            .join("، ")
                        : "موزع على جميع الخيل النشطة"}
                    </p>
                    <p className="muted small">
                      {isFeedPurchase(expenseState, e)
                        ? "مشتريات العلف في"
                        : "تكلفة"}{" "}
                      {displayMonth(month)}: {money(expensePlan(s, e, month))} ر.س{" "}
                      {expenseIsShared(e)
                        ? expenseHorseCount
                          ? `÷ ${expenseHorseCount} خيل خلال الشهر`
                          : "بانتظار إضافة خيل نشطة لتوزيعه"
                        : "على الخيل المرتبطة"}
                    </p>
                    {isFeedPurchase(expenseState, e) && (
                      <p className="notice">
                        شراء علف: يظهر منفصلًا. تكلفة التغذية تعتمد على كمية
                        الاستهلاك المسجلة لكل خيل ولا تكرر قيمة الشراء.
                      </p>
                    )}
                    <div className="payment-summary">
                      <span>
                        المسدد: {money(expensePaid(s, e.id, month))}{" "}
                        ر.س
                      </span>
                      {expensePlan(s,e,month)<=expensePaid(s,e.id,month)?<b>مسدد بالكامل</b>:<b>
                        متبقي{" "}
                        {money(
                          Math.max(
                            0,
                            expensePlan(s, e, month) -
                              expensePaid(s, e.id, month),
                          ),
                        )}{" "}
                        ر.س
                      </b>}
                    </div>
                    {!coveredFeedPlan(expenseState, e, month) &&
                      expensePlan(s, e, month) >
                        expensePaid(s, e.id, month) && (
                        <Button kind="gold" onClick={() => payExpense(e)}>
                          تسجيل سداد مصروف
                        </Button>
                      )}
                    {coveredFeedPlan(expenseState, e, month) && (
                      <p className="notice small">
                        خطة شراء يغطيها الشراء المسجل من المخزون؛ لا تسددها مرة
                        ثانية.
                      </p>
                    )}
                    {isAdmin&&e.frequency!=="once"&&<Button kind="outline" onClick={()=>setForm({title:"بداية احتساب المصروف",fields:[{name:"startDate",label:"تاريخ بداية الاحتساب",type:"date",required:true},{name:"reason",label:"سبب التعديل",type:"textarea",required:true}],values:{startDate:e.accrualStartDate||((e.startMonth||accountingStart(s).slice(0,7)||today().slice(0,7))+"-01"),reason:""},submit:d=>execute({action:"expense.start",id:e.id,data:d})})}>تعديل بداية الاحتساب</Button>}
                    {expenseMonthClosed ||
                    e.collectedHorseIds?.length > 0 ||
                    s.expensePayments.some((p) => p.expenseId === e.id) ? (
                      <p className="notice">
                        مرتبط بسجلات مالية؛ يحتفظ السجل بالتكلفة والتوزيع
                        الأصليين.
                      </p>
                    ) : (
                      <div className="actions">
                        <Button kind="outline" onClick={() => expenseForm(e)}>
                          تعديل
                        </Button>
                        {isAdmin && (
                          <Button
                            kind="danger"
                            onClick={() =>
                              confirm(
                                "حذف المصروف",
                                `سيحذف المصروف «${e.name}».`,
                                () =>
                                  execute({
                                    action: "expense.delete",
                                    id: e.id,
                                  }),
                              )
                            }
                          >
                            حذف
                          </Button>
                        )}
                      </div>
                    )}
                  </section>
                ))}
                <section className="card">
                  <h2>سجل سداد مصروفات {displayMonth(month)}</h2>
                  {s.expensePayments
                    .filter(
                      (p) =>
                        p.cashCategory !== "inventory" && p.expenseKind !== "feed_purchase" && (p.period === month ||
                        String(p.paidAt).slice(0, 7) === month),
                    )
                    .slice()
                    .sort((a, b) =>
                      String(b.createdAt).localeCompare(String(a.createdAt)),
                    )
                    .map((p) => (
                      <div className="payment-record" key={p.id}>
                        <div className="spread">
                          <b>{p.expenseName}</b>
                          <b
                            className={
                              p.status === "void" ? "void-payment" : ""
                            }
                          >
                            {money(p.amount)} ر.س
                          </b>
                        </div>
                        <p className="small muted">
                          دُفع {displayDate(p.paidAt)} · يخص {displayMonth(p.period)}{" "}
                          {p.notes ? `· ${p.notes}` : ""}
                        </p>
                        {p.purchaseAdjustment && <p className="small muted">فرق تسوية تصحيح شراء سابق · {p.notes}</p>}
                        {p.status === "void" ? (
                          <p className="small value-negative">
                            سداد ملغى: {p.voidReason}
                          </p>
                        ) : (
                          isAdmin &&
                          !p.stockTransactionId && (
                            <button
                              className="danger-text"
                              onClick={() =>
                                setForm({
                                  title: "إلغاء سداد مسجل",
                                  fields: [
                                    {
                                      name: "reason",
                                      label: "سبب الإلغاء",
                                      required: true,
                                    },
                                  ],
                                  values: {},
                                  note: `سيُلغى أثر سداد ${money(p.amount)} ريال للمصروف «${p.expenseName}» مع حفظ السجل والسبب.`,
                                  submit: (d) =>
                                    execute({
                                      action: "expense.payment.void",
                                      id: p.id,
                                      data: d,
                                    }),
                                })
                              }
                            >
                              إلغاء السداد
                            </button>
                          )
                        )}
                      </div>
                    ))}
                  {!s.expensePayments.some(
                    (p) =>
                      p.cashCategory !== "inventory" && p.expenseKind !== "feed_purchase" && (p.period === month ||
                      String(p.paidAt).slice(0, 7) === month),
                  ) && (
                    <p className="muted">لا توجد مدفوعات مسجلة لهذه الفترة.</p>
                  )}
                </section>
                {!s.expenses.length && <Empty />}
                </div>
              </>
            )}
            {tab === "owners" && isStaff && (
              <>
                {heading(
                  "بيانات الملاك وخيلهم",
                  <button
                    className="round-add"
                    aria-label="إضافة مالك"
                    onClick={() => ownerForm()}
                  >
                    <Plus />
                  </button>,
                )}
                <p className="notice">
                  إضافة المالك لا تمنحه دخولًا ولا ترسل له دعوة. أنت تدير خيله
                  وحساباته من هنا.
                </p>
                {searchBox}
                {filtered(s.owners, [
                  "displayName",
                  "phoneNumber",
                  "email",
                ]).map((o) => {
                  const horses = s.horses.filter((h) => h.ownerId === o.id);
                  const linked = s.users.find(
                    (u) => u.id === o.linkedUserId && !u.deleted,
                  );
                  return (
                    <section className="card" key={o.id}>
                      <div className="spread">
                        <h2>{o.displayName}</h2>
                        <span className="pill">
                          {linked
                            ? linked.disabled
                              ? "دخول معطل"
                              : "حساب دخول مرتبط"
                            : "سجل فقط"}
                        </span>
                      </div>
                      <p className="muted">{o.phoneNumber ? displayIdentifier(o.phoneNumber) : "بدون جوال"}</p>
                      {o.email && <p className="muted ltr">{o.email}</p>}
                      <p>
                        {displayNumber(horses.filter((h) => h.status !== "archived").length)}{" "}
                        خيل نشطة ·{" "}
                        {displayNumber(horses.filter((h) => h.status === "archived").length)}{" "}
                        مؤرشفة
                      </p>
                      <p className="muted">
                        إجمالي التحصيل المسجل:{" "}
                        {money(
                          s.income
                            .filter((i) => i.ownerId === o.id)
                            .reduce((sum, i) => sum + Number(i.amount || 0), 0),
                        )}{" "}
                        ر.س
                      </p>
                      {o.notes && <p className="muted">{o.notes}</p>}
                      <div className="actions">
                        <Button kind="outline" onClick={() => ownerForm(o)}>
                          تعديل البيانات
                        </Button>
                        {isAdmin && !linked && (
                          <Button
                            kind="outline"
                            onClick={() => memberForm(undefined, o)}
                          >
                            تفعيل دخول المالك
                          </Button>
                        )}
                        {isAdmin &&
                          linked &&
                          linked.id !== a.uid &&
                          linked.email?.toLowerCase() !==
                            "amjadoh@gmail.com" && (
                            <Button
                              kind="outline"
                              onClick={() => memberForm(linked)}
                            >
                              إدارة حساب الدخول
                            </Button>
                          )}
                      </div>
                      {horses.map((h) => (
                        <button
                          className="list-link"
                          key={h.id}
                          onClick={() => horseDetail(h)}
                        >
                          <HorseIcon />
                          <span>{h.name}</span>
                          <ChevronLeft />
                        </button>
                      ))}
                    </section>
                  );
                })}
                {!s.owners.length && (
                  <Empty text="أضف المالك ثم سجّل خيله؛ لا يحتاج حسابًا أو بريدًا." />
                )}
              </>
            )}
            {tab === "members" && isStaff && (
              <>
                {heading(
                  "العضوية والصلاحيات",
                  isAdmin ? (
                    <button
                      className="round-add"
                      aria-label="تسجيل عضو"
                      onClick={() => memberForm()}
                    >
                      <Plus />
                    </button>
                  ) : undefined,
                )}
                {searchBox}
                {filtered(
                  s.users.filter((u) => !u.deleted),
                  ["displayName", "email", "phoneNumber"],
                ).map((u) => (
                  <section className="card" key={u.id}>
                    <div className="spread">
                      <h2>{u.displayName}</h2>
                      <span className={`pill ${u.disabled ? "red" : ""}`}>
                        {u.disabled ? "معطل" : roles[u.role]}
                      </span>
                    </div>
                    <p className="muted ltr">{u.email}</p>
                    <p className="muted">{displayIdentifier(u.phoneNumber)}</p>
                    {u.email?.toLowerCase() === "amjadoh@gmail.com" ? (
                      <p className="muted">المدير الأساسي</p>
                    ) : (
                      !u.membershipApproved && (
                        <p className="notice">
                          العضوية تحتاج اعتماد المدير قبل السماح بالدخول.
                        </p>
                      )
                    )}
                    {u.invitationStatus && (
                      <p className="muted">
                        الدعوة:{" "}
                        {(
                          {
                            queued: "بانتظار الإرسال",
                            not_sent: "لم تُطلب دعوة",
                            setup_required: "إرسال الدعوات لم يُفعّل بعد",
                            sending: "جارٍ الإرسال",
                            sent: "أُرسلت",
                            failed:
                              "تعذر الإرسال؛ أعد المحاولة بعد التحقق من خدمة البريد",
                          } as Record<string, string>
                        )[u.invitationStatus] || u.invitationStatus}
                      </p>
                    )}
                    {isAdmin &&
                      u.id !== a.uid &&
                      u.email?.toLowerCase() !== "amjadoh@gmail.com" && (
                        <>
                          <div className="actions">
                            <Button
                              kind="outline"
                              onClick={() => memberForm(u)}
                            >
                              {u.membershipApproved
                                ? "تعديل الصلاحية"
                                : "اعتماد العضوية والصلاحية"}
                            </Button>
                            {u.membershipApproved && !u.disabled && (
                              <Button
                                kind="outline"
                                disabled={
                                  busy ||
                                  ["queued", "sending"].includes(
                                    u.invitationStatus,
                                  )
                                }
                                onClick={() =>
                                  void run(() => member("invite", u.id))
                                }
                              >
                                {u.invitationStatus === "not_sent"
                                  ? "إرسال دعوة"
                                  : "إعادة إرسال الدعوة"}
                              </Button>
                            )}
                            <Button
                              kind="outline"
                              onClick={() =>
                                confirm(
                                  u.disabled ? "تفعيل العضو" : "تعطيل العضو",
                                  u.disabled
                                    ? "سيتمكن العضو من الدخول مجددًا."
                                    : "سيمنع العضو من استخدام الحساب حتى إعادة تفعيله.",
                                  () =>
                                    member(
                                      u.disabled ? "enable" : "disable",
                                      u.id,
                                    ),
                                )
                              }
                            >
                              {u.disabled ? "تفعيل" : "تعطيل"}
                            </Button>
                          </div>
                          <button
                            className="danger-text"
                            onClick={() =>
                              confirm(
                                "حذف العضو",
                                "يحذف حساب الدخول ويُحفظ أثره في السجلات المالية. لا يسمح بالحذف عند وجود خيل نشطة مرتبطة به.",
                                () => member("delete", u.id),
                              )
                            }
                          >
                            حذف العضو
                          </button>
                        </>
                      )}
                  </section>
                ))}
              </>
            )}
            {tab === "activity" && (
              <>
                {heading("التنبيهات وآخر التغييرات")}
                {isStaff && pending.length > 0 && (
                  <Button kind="gold" onClick={() => go("requests")}>
                    {displayNumber(pending.length)} طلبات تنتظر مراجعتك
                  </Button>
                )}
                {s.activities
                  .slice()
                  .reverse()
                  .slice(0, 100)
                  .map((l) => (
                    <div className="record" key={l.id}>
                      <b>{actionLabel(l.action)}</b>
                      <p>{l.performedByName || "الإدارة"}</p>
                      <small>
                        {displayDateTime(l.createdAt)}
                      </small>
                    </div>
                  ))}
                {!s.activities.length && (
                  <Empty text="ستظهر العمليات المسجلة هنا" />
                )}
              </>
            )}
            {tab === "more" && (
              <>
                {heading(roles[a.role])}
                <section className="account-card">
                  <div className="profile-icon">{a.displayName.charAt(0)}</div>
                  <h2>{a.displayName}</h2>
                  <span className="pill">{roles[a.role]}</span>
                </section>
                <section className="card">
                  {isStaff && (
                    <>
                      <MenuLink
                        icon={<Users />}
                        label="سجل الملاك"
                        onClick={() => go("owners")}
                      />
                      <MenuLink
                        icon={<ClipboardList />}
                        label="طلبات تسجيل الخيل"
                        count={pending.length}
                        onClick={() => go("requests")}
                      />
                      <MenuLink
                        icon={<Wallet />}
                        label="المصروفات"
                        onClick={() => go("expenses")}
                      />
                      {isAdmin && (
                        <MenuLink
                          icon={<Users />}
                          label="إدارة الأعضاء والصلاحيات"
                          onClick={() => go("members")}
                        />
                      )}
                    </>
                  )}
                  <MenuLink
                    icon={<History />}
                    label="سجل العمليات"
                    onClick={() => go("activity")}
                  />
                  <MenuLink
                    icon={<Users />}
                    label="بيانات حسابي"
                    onClick={() =>
                      setForm({
                        title: "بيانات حسابي",
                        fields: [
                          {
                            name: "displayName",
                            label: "الاسم",
                            required: true,
                          },
                          { name: "phoneNumber", label: "الجوال", type: "tel" },
                        ],
                        values: s.users.find((u) => u.id === a.uid) || {},
                        submit: (d) =>
                          execute({ action: "profile.save", data: d }),
                      })
                    }
                  />
                  {isAdmin && (
                    <MenuLink
                      icon={<SlidersHorizontal />}
                      label="هوية الإسطبل"
                      onClick={() =>
                        setForm({
                          title: "بيانات الإسطبل",
                          fields: [
                            {
                              name: "stableName",
                              label: "اسم الإسطبل",
                              required: true,
                            },
                            { name: "phone", label: "الجوال", type: "tel" },
                            { name: "address", label: "العنوان" },
                          ],
                          values: s.settings[0] || { stableName: name },
                          submit: (d) =>
                            execute({ action: "settings.save", data: d }),
                          note: "أيقونة التطبيق تستخدم شعار الأثيل الأصلي المرفق.",
                        })
                      }
                    />
                  )}
                </section>
                <Button kind="outline" onClick={() => void run(logout)}>
                  <LogOut size={18} />
                  تسجيل الخروج
                </Button>
                {isAdmin && (
                  <Button
                    kind="outline"
                    disabled={busy}
                    onClick={() => void run(() => member("invite", a.uid))}
                  >
                    إرسال رابط التطبيق إلى بريدي
                  </Button>
                )}
                <p className="muted small center">
                  الأثيل · الإصدار {RELEASE_VERSION} · أندرويد
                </p>
                <UpdateButton />
              </>
            )}
          </div>
        )}
      </main>
      <FeedbackLauncher visible={!!isAdmin && a?.dataReady === true && !feedbackOpen && !helpOpen && !form && !detail && !accountHorseId && !releaseOpen && !accountMenuOpen && !busy} onOpen={()=>setFeedbackOpen(true)}/>
      {a && (
        <nav className="bottom-nav" aria-label="التنقل الرئيسي">
          {nav.map(([key, label, Icon]) => {
            const I = Icon as typeof LayoutDashboard;
            return (
              <button
                key={String(key)}
                className={tab === key ? "active" : ""}
                onClick={() => go(String(key))}
              >
                <I size={22} />
                <span>{String(label)}</span>
              </button>
            );
          })}
        </nav>
      )}
      {toast && (
        <div className="toast" role="status">
          <Check size={18} />
          {toast}
        </div>
      )}
      {error && (
        <div className="error-banner" role="alert">
          <span>{error}</span>
          <button aria-label="إغلاق الخطأ" onClick={() => setError("")}>
            <X size={18} />
          </button>
        </div>
      )}
      {busy && (
        <div className="busy" role="status">
          جارٍ تنفيذ العملية…
        </div>
      )}
      {releaseOpen && a && (
        <Modal
          title={`ما الجديد في الأثيل ${RELEASE_VERSION}؟`}
          close={closeRelease}
        >
          <p>أبرز التغييرات في هذا التحديث:</p>
          <div className="release-notes" dir="rtl">
            {RELEASE_NOTES.map((section) => (
              <section key={section.title}>
                <h3>{section.title}</h3>
                <ul>
                  {section.items.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </Modal>
      )}
      {helpOpen && a && <Modal title="التعليمات" close={()=>setHelpOpen(false)}><HelpPanel role={a.role}/></Modal>}
      {feedbackOpen && isAdmin && a?.dataReady && <Modal title="بلاغات التطبيق" close={()=>{if(!busy)setFeedbackOpen(false);}}><FeedbackPanel primary={s.users.some(u=>u.id===a.uid&&String(u.email).toLowerCase()==="amjadoh@gmail.com")} actor={a} onBusy={setBusy}/></Modal>}
      {loginOpen && (
        <Modal title="أهلًا بك في الأثيل" close={() => setLoginOpen(false)}>
          <img className="login-logo" src="/logo.jpeg" alt="شعار الأثيل" />
          <p>سجل دخولك للوصول إلى لوحة المعلومات وطلبات الخيل.</p>
          <Button kind="gold" disabled={busy} onClick={() => void run(login)}>
            تسجيل الدخول باستخدام Google
          </Button>
          <p className="muted small">
            الدخول متاح للإيميلات التي يضيفها مدير الإسطبل فقط. اختر حساب Google
            المطابق لبريد العضوية.
          </p>
          {error && (
            <p className="notice" role="alert">
              {error}
            </p>
          )}
        </Modal>
      )}
      {form && (
        <Modal title={form.title} close={() => !busy && setForm(null)}>
          <>
            {error && (
              <p className="notice" role="alert">
                {error}
              </p>
            )}
            <FormView
              form={form}
              state={s}
              busy={busy}
              onSubmit={(d) => void run(() => form.submit(d))}
            />
          </>
        </Modal>
      )}
      {accountHorseId && s.horses.some((h) => h.id === accountHorseId) && (
        <Modal
          title="كشف حساب الخيل"
          close={() => !busy && setAccountHorseId(null)}
        >
          <HorseAccount
            key={accountHorseId}
            state={s}
            horse={s.horses.find((h) => h.id === accountHorseId)!}
            canPay={isStaff && a?.dataReady !== false}
            canModify={a?.role === "admin" && a?.dataReady !== false}
            onChange={async (action, id, data, requestId) => {
              setBusy(true);
              try {
                await execute({ action, id, data, requestId });
                setToast(action === "income.void" ? "تم إلغاء الدفعة وإعادة حساب الرصيد" : "تم تصحيح الدفعة وإعادة حساب الرصيد");
              } finally { setBusy(false); }
            }}
            onPay={async (data, requestId) => {
              setBusy(true);
              try {
                await execute({
                  action: "income.pay",
                  id: accountHorseId,
                  requestId,
                  data,
                });
                setToast("تم تسجيل الدفعة وتوزيعها على الاستحقاقات");
              } finally {
                setBusy(false);
              }
            }}
          />
        </Modal>
      )}
      {detail && (!detail.horseId || detailHorse) && (
        <Modal title={detailHorse?.name || detail.title} close={() => !busy && setDetail(null)}>
          {error && (
            <p className="notice" role="alert">
              {error}
            </p>
          )}
          {detailHorse ? renderHorseDetail(detailHorse) : detail.content}
        </Modal>
      )}
    </div>
  );
}
function MenuLink({
  icon,
  label,
  count,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  count?: number;
  onClick: () => void;
}) {
  return (
    <button className="list-link" onClick={onClick}>
      {icon}
      <span>{label}</span>
      {!!count && <b className="pill">{displayNumber(count)}</b>}
      <ChevronLeft size={18} />
    </button>
  );
}
function Modal({
  title,
  children,
  close,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
    return () => ref.current?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      dir="rtl"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      aria-label={title}
    >
      <div className="modal-heading">
        <h2>{title}</h2>
        <button className="icon-button" onClick={close} aria-label="إغلاق">
          <X />
        </button>
      </div>
      <div className="modal-body">{children}</div>
    </dialog>
  );
}
function FormView({
  form,
  state,
  busy,
  onSubmit,
}: {
  form: Form;
  state: State;
  busy: boolean;
  onSubmit: (d: Record<string, any>) => void;
}) {
  const [v, set] = useState<Record<string, any>>(() =>
    structuredClone(form.values),
  );
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState("");
  const update = (name: string, value: unknown) =>
    set((p) => ({ ...p, [name]: value,
      ...(name === "paidAt" && form.fields.some(f=>f.name==="costPeriod") && !p.costPeriodManual
        ? {costPeriod:purchasePeriod(value)} : {}),
      ...(name === "costPeriod" ? {costPeriodManual:true} : {}),
    }));
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!photoBusy && (!form.feeding || !feedingFormError(v.feeding || []))) onSubmit(v);
      }}
    >
      {form.note && <p className="notice">{form.note}</p>}
      {form.feeding && feedingFormError(v.feeding || []) && <p className="notice error" role="alert">{feedingFormError(v.feeding || [])}</p>}
      {form.horsePhoto && (
        <section className="photo-field">
          <span>صورة الخيل (اختيارية)</span>
          <HorsePhoto
            horse={{ ...v, id: "preview", name: v.name || "الخيل" }}
            large
          />
          <label className="button outline">
            {photoBusy ? "جارٍ تجهيز الصورة…" : "اختيار صورة الخيل"}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={photoBusy || busy}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                setPhotoBusy(true);
                setPhotoError("");
                try {
                  update("photoURL", await prepareHorsePhoto(file));
                } catch (err) {
                  setPhotoError((err as Error).message);
                } finally {
                  setPhotoBusy(false);
                }
              }}
            />
          </label>
          {v.photoURL && (
            <button
              type="button"
              className="danger-text"
              onClick={() => {
                update("photoURL", "");
                setPhotoError("");
              }}
            >
              إزالة صورة الخيل
            </button>
          )}
          {photoError && (
            <p className="value-negative" role="alert">
              {photoError}
            </p>
          )}
        </section>
      )}
      {form.inventoryDefinition &&
        similarItems(state.mealTypes, v.name, form.values.id).length > 0 && (
          <div className="notice warning">
            <p>
              أصناف مشابهة:{" "}
              {similarItems(state.mealTypes, v.name, form.values.id)
                .map((m) => m.name)
                .join("، ")}
              . للشراء اختر الصنف الموجود.
            </p>
            <label className="check-field">
              <input
                type="checkbox"
                checked={v.confirmSimilar === true}
                onChange={(e) => update("confirmSimilar", e.target.checked)}
              />{" "}
              راجعت الأصناف وهذا صنف مختلف فعلًا
            </label>
          </div>
        )}
      {form.inventoryItem && (
        <div className="notice" aria-live="polite">
          <b>مراجعة الشراء قبل الحفظ</b>
          <p>
            الرصيد بعد الإضافة:{" "}
            {money(
              Number(
                state.mealTypes.find((m) => m.id === form.inventoryItem)
                  ?.currentStock || 0,
              ) + Number(v.amount || 0),
            )}{" "}
            {state.mealTypes.find((m) => m.id === form.inventoryItem)?.unit}
          </p>
          <p>المدفوع المسجل: {money(v.total)} ر.س</p>
          <p>
            سعر الوحدة لهذه الفاتورة:{" "}
            {money(
              Number(v.total || 0) / Math.max(Number(v.amount || 0), 0.01),
            )}{" "}
            ر.س
          </p>
        </div>
      )}
      {form.fields
        .filter((f) => !f.when || v[f.when[0]] === f.when[1])
        .map((f) => (
          <label className="field" key={f.name}>
            <span>
              {f.label}
              {f.required && <b> *</b>}
            </span>
            {f.options ? (
              <select
                required={f.required}
                value={v[f.name] ?? f.options[0]?.[0] ?? ""}
                onChange={(e) => update(f.name, e.target.value)}
              >
                {f.options.map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            ) : f.type === "textarea" ? (
              <textarea
                required={f.required}
                maxLength={500}
                value={v[f.name] ?? ""}
                onChange={(e) => update(f.name, e.target.value)}
              />
            ) : (
              <input
                type={f.type || "text"}
                required={f.required}
                min={f.min}
                max={f.max}
                step={
                  f.type === "number"
                    ? f.name === "feedingUnitsPerPurchaseUnit"
                      ? "any"
                      : "0.01"
                    : undefined
                }
                maxLength={f.type === "text" || !f.type ? 500 : undefined}
                value={v[f.name] ?? ""}
                onChange={(e) => update(f.name, e.target.value)}
              />
            )}
          </label>
        ))}
      {form.feeding && <FeedingEditor plans={v.feeding || []} meals={state.mealTypes} month={today().slice(0,7)} onChange={plans=>update("feeding",plans)} />}
      {form.horses && v.allocationScope === "selected" && (
        <fieldset>
          <legend>ربط المصروف بالخيل</legend>
          {state.horses
            .filter(
              (h) =>
                h.status !== "archived" &&
                (v.chargedTo !== "owner" || h.status !== "private"),
            )
            .map((h) => (
              <label className="check-field" key={h.id}>
                <input
                  type="checkbox"
                  checked={(v.horseIds || []).includes(h.id)}
                  onChange={(e) =>
                    update(
                      "horseIds",
                      e.target.checked
                        ? [...(v.horseIds || []), h.id]
                        : (v.horseIds || []).filter(
                            (id: string) => id !== h.id,
                          ),
                    )
                  }
                />
                {h.name} — {h.ownerName}
              </label>
            ))}
        </fieldset>
      )}
      <button
        className="button gold"
        type="submit"
        disabled={busy || photoBusy}
      >
        {busy ? "جارٍ الحفظ…" : "حفظ ومتابعة"}
      </button>
    </form>
  );
}
function actionLabel(action: string) {
  return (
    (
      {
        "horse.save": "تسجيل أو تحديث خيل",
        "owner.save": "تسجيل أو تحديث مالك",
        "horse.checkout": "إخراج خيل",
        "horse.restore": "استعادة خيل",
        "request.create": "طلب تسجيل جديد",
        "request.review": "مراجعة طلب",
        "request.accept": "اعتماد وتسجيل الخيل",
        "meal.save": "تحديث صنف",
        "meal.delete": "حذف صنف",
        "stock.move": "حركة مخزون",
        "stock.purchase": "شراء مخزون مدفوع",
        "stock.purchase.correct": "تصحيح عملية شراء",
        "finance.rollover": "حفظ الفترة المالية",
        "expense.save": "تسجيل مصروف",
        "expense.pay": TERMS.expensePayment,
        "expense.payment.void": "إلغاء سداد مصروف",
        "finance.snapshot": "حفظ التقرير المالي",
        "expense.delete": "حذف مصروف",
        "income.collect": "تحصيل رسوم الإيواء",
        "income.pay": "تسجيل دفعة من المالك",
        "income.correct": "تصحيح دفعة من المالك",
        "income.void": "إلغاء دفعة من المالك",
        "profile.save": "تحديث الحساب",
        "settings.save": "تحديث بيانات الإسطبل",
        "member.create": "تسجيل عضو",
        "member.update": "تحديث صلاحيات عضو",
        "member.disable": "تعطيل عضو",
        "member.enable": "تفعيل عضو",
        "member.delete": "حذف عضو",
      } as Record<string, string>
    )[action] || "تحديث سجل"
  );
}
