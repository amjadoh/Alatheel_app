import { TERMS } from "./terms";
import { useEffect, useState } from "react";
import {
  ArrowUpLeft,
  TrendingDown,
  TrendingUp,
  Wallet,
  Receipt,
  AlertCircle,
} from "lucide-react";
import type { Row, State } from "./service";
import { financialSummary, horseFinance } from "../functions/src/finance";
import {
  displayAmount,
  displayMonth,
  displayNumber,
  displayPrice,
  displayQuantity,
} from "./format";

export const amount = displayAmount;
export function HorsePhoto({
  horse,
  large = false,
}: {
  horse: Row;
  large?: boolean;
}) {
  const source =
    typeof horse.photoURL === "string"
      ? horse.photoURL
      : horse.imageUrl || horse.imageURL || "";
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [source]);
  const safe = /^(https:\/\/|data:image\/(jpeg|png|webp);base64,)/.test(source);
  return (
    <div className={`horse-photo ${large ? "large" : ""}`}>
      {safe && !failed ? (
        <img
          src={source}
          alt={`صورة ${horse.name}`}
          onError={() => setFailed(true)}
        />
      ) : (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          aria-label="صورة الخيل غير مضافة"
        >
          <path d="m6 21 1-7-3-3 5-7 4 2 4-2 3 6-6 3-1 8M9 4l1-3 3 5M7 14l7-1" />
        </svg>
      )}
    </div>
  );
}
export function HorseFinancialPanel({
  state,
  horse,
  month,
  staff,
  figures,
}: {
  state: State;
  horse: Row;
  month: string;
  staff: boolean;
  figures?: ReturnType<typeof horseFinance>;
}) {
  const f = figures || horseFinance(state, horse, month);
  return (
    <section className="horse-finance">
      <div className="section-heading compact">
        <h2>حساب {horse.name}</h2>
        <span className="pill">{displayMonth(month)}</span>
      </div>
      <div className="finance-mini-grid">
        {!f.privateHorse && (
          <div>
            <span>إيواء شهري متوقع</span>
            <b>
              {amount(f.expected)} <small>ر.س</small>
            </b>
          </div>
        )}
        {staff && (
          <div>
            <span>تكلفته المقدّرة</span>
            <b>
              {amount(f.total)} <small>ر.س</small>
            </b>
          </div>
        )}
        {!f.privateHorse && (
          <div>
            <span>التحصيل خلال الشهر</span>
            <b>
              {amount(f.cash)} <small>ر.س</small>
            </b>
          </div>
        )}
        {!f.privateHorse && (
          <div>
            <span>متبقي حتى نهاية الشهر</span>
            <b
              className={
                f.outstanding > 0 ? "value-negative" : "value-positive"
              }
            >
              {amount(f.outstanding)} <small>ر.س</small>
            </b>
          </div>
        )}
      </div>
      {staff && (
        <>
          <div
            className={`profit-banner ${f.margin < 0 && !f.privateHorse ? "negative" : !f.complete ? "incomplete" : "positive"}`}
          >
            <span>
              {f.privateHorse
                ? "ملك الإسطبل · تكلفة بدون إيراد إيواء"
                : !f.complete
                  ? f.margin < 0
                    ? "عجز مقدّر على الأقل · تكلفة ناقصة"
                    : "نتيجة التشغيل المبدئية · التكلفة غير مكتملة"
                  : f.margin < 0
                    ? "عجز تشغيل مقدّر"
                    : "فائض تشغيل مقدّر"}
            </span>
            <strong>
              {amount(f.privateHorse ? f.total : f.margin)} <small>ر.س</small>
            </strong>
          </div>
          <dl className="ledger">
            <dt>استهلاك التغذية</dt>
            <dd>{amount(f.food)} ر.س</dd>
            <dt>المصروفات المشتركة والخاصة</dt>
            <dd>{amount(f.other)} ر.س</dd>
            {!f.privateHorse && f.recoveredExpected > 0 && (
              <>
                <dt>مصروفات تُسترد من المالك</dt>
                <dd>{amount(f.recoveredExpected)} ر.س</dd>
              </>
            )}
            {!f.privateHorse && (
              <>
                <dt>متبقي إيواء</dt>
                <dd>{amount(f.boardingOutstanding)} ر.س</dd>
                <dt>مصروفات متبقية على المالك</dt>
                <dd>{amount(f.extrasOutstanding)} ر.س</dd>
              </>
            )}
          </dl>
          {f.missing.length > 0 && (
            <p className="notice warning">
              التكلفة غير مكتملة: {f.missing.join("، ")}. لا تعتمد نتيجة التشغيل
              المعروض كربح نهائي.
            </p>
          )}
          <p className="small muted">
            {f.privateHorse ? (
              "خيل ملك خاص؛ يحسب ضمن تكلفة التغذية والمصروفات دون إيراد إيواء أو تحصيل على المالك."
            ) : (
              <>
                الإيواء وفق سياسة الشهر الكامل أو الأيام المسجلة للخيل. التغذية
                حسب الكمية والمواعيد المسجلة وأيام الإقامة. الخطط الشهرية القديمة
                دون مواعيد محددة تبقى تقديرية حتى تحديد أيامها.
                المتبقي يشمل الدورات حتى نهاية الشهر. الأشهر المغلقة تحتفظ
                بحساباتها وأسعارها. تأخر التحصيل يظهر منفصلًا عن عجز التشغيل.
              </>
            )}
          </p>
        </>
      )}
    </section>
  );
}
export function FinancialDashboard({
  state,
  month,
  onGo,
  onHorse,
  onSave,
  admin,
}: {
  state: State;
  month: string;
  onGo: (page: string) => void;
  onHorse: (h: Row) => void;
  onSave: () => void;
  admin: boolean;
}) {
  const live = financialSummary(state, month);
  const closed = state.financialPeriods.find((p) => p.id === month && p.closed);
  const tracking = state.financialPeriods.length > 0;
  const saved = state.financialReports.find((r) => r.id === month);
  const [showSaved, setShowSaved] = useState(false);
  useEffect(() => setShowSaved(false), [month]);
  const f = showSaved && saved ? (saved.summary as typeof live) : live;
  return (
    <>
      <section className="finance-headline">
        <p className="eyebrow">وضع الإسطبل · {displayMonth(month)}</p>
        {closed ? (
          <p className="notice">
            شهر مغلق تلقائيًا · الأسعار والكميات والحسابات محفوظة كما كانت عند
            الإغلاق.
          </p>
        ) : (
          <p className="small muted">
            {tracking &&
            month < state.financialPeriods.map((p) => p.id).sort()[0]
              ? "فترة قديمة قبل بدء الحفظ التلقائي؛ الأرقام تقدير بالبيانات المتاحة."
              : "الشهر الجاري مفتوح؛ يحفظ تلقائيًا عند بدء الشهر التالي قبل أي تعديل."}
          </p>
        )}
        <h2>{TERMS.cashDifference}</h2>
        <div
          className={`headline-amount ${f.cashBalance < 0 ? "value-negative" : "value-positive"}`}
        >
          {f.cashBalance < 0 ? <TrendingDown /> : <TrendingUp />}
          <strong>{amount(f.cashBalance)}</strong>
          <span>ر.س</span>
        </div>
        <p>
          حصلت {amount(f.collected)} − دفعت {amount(f.paid)} ر.س
        </p>
        <p className="small muted">
          وفق تواريخ التحصيل والدفع المسجلة؛ يشمل شراء المخزون والرواتب
          والمصروفات المسددة. لا يشمل رصيدًا افتتاحيًا ولا يمثل رصيد البنك.
        </p>
      </section>
      <div className="dashboard-grid finance-grid">
        <button className="stat gold" onClick={() => onGo("income")}>
          <Wallet />
          <span>حصلت من الملاك</span>
          <strong>{amount(f.collected)}</strong>
          <small>تحصيل فعلي خلال الشهر</small>
        </button>
        <button className="stat" onClick={() => onGo("inventory")}>
          <Receipt />
          <span>دفعت للمخزون</span>
          <strong>{amount(f.inventoryPaid || 0)}</strong>
          <small>مشتريات علف مسددة</small>
        </button>
        <button className="stat" onClick={() => onGo("expenses")}>
          <Receipt />
          <span>دفعت للرواتب</span>
          <strong>{amount(f.salaryPaid || 0)}</strong>
          <small>سداد فعلي</small>
        </button>
        <button className="stat" onClick={() => onGo("expenses")}>
          <Receipt />
          <span>دفعت لمصروفات أخرى</span>
          <strong>{amount(f.otherPaid ?? f.paid)}</strong>
          <small>مثل الطبيب والخدمات</small>
        </button>
      </div>
      <section className="card">
        <h2>الدخل والتكلفة المتوقعة</h2>
        <div
          className={`profit-banner ${f.operatingBalance < 0 ? "negative" : "positive"}`}
        >
          <span>
            {f.operatingBalance < 0 ? "عجز تشغيل مقدّر" : "فائض تشغيل مقدّر"}
          </span>
          <strong>{amount(f.operatingBalance)} ر.س</strong>
        </div>
        <p className="small muted">
          الدخل المتوقع − استهلاك التغذية ومصروفات التشغيل. المصروف غير المدفوع
          يدخل في التكلفة، ويظهر ضمن المدفوعات عند سداده فقط.{" "}
          {f.incompleteCount
            ? "التكلفة مبدئية لوجود بيانات تغذية ناقصة."
            : "التقدير حسب برنامج التغذية وأيام الإقامة وسياسة الإيواء."}
        </p>{" "}
      </section>
      <div className="dashboard-grid finance-grid">
        <button className="stat dark" onClick={() => onGo("income")}>
          <Wallet />
          <span>الدخل المتوقع</span>
          <strong>{amount(f.revenue)}</strong>
          <small>
            إيواء {amount(f.expected)}
            {f.recoveries ? ` + مصروفات تُسترد ${amount(f.recoveries)}` : ""}
          </small>
        </button>
        <button className="stat" onClick={() => onGo("expenses")}>
          <Receipt />
          <span>تكلفة التشغيل المقدّرة</span>
          <strong>{amount(f.total)}</strong>
          <small>
            التغذية {amount(f.feeding)} · التشغيل {amount(f.other)}
          </small>
        </button>
        <button className="stat gold" onClick={() => onGo("income")}>
          <Wallet />
          <span>التحصيل خلال الشهر</span>
          <strong>{amount(f.collected)}</strong>
          <small>وفق تاريخ التحصيل الفعلي</small>
        </button>
        <button className="stat" onClick={() => onGo("income")}>
          <AlertCircle />
          <span>متبقي على الملاك</span>
          <strong className={f.outstanding ? "value-negative" : ""}>
            {amount(f.outstanding)}
          </strong>
          <small>{displayNumber(f.debtCount)} خيل · حتى نهاية الشهر، شامل السابق</small>
        </button>
      </div>
      <div className="quick-actions">
        <button className="button gold" onClick={() => onGo("income")}>
          تسجيل تحصيل
        </button>
        <button className="button outline" onClick={() => onGo("expenses")}>
          سداد مصروف
        </button>
        <button className="button outline" onClick={() => onGo("horses")}>
          حسابات الخيل
        </button>
      </div>
      <section className="card cash-card">
        <h2>تغطية التزامات الشهر</h2>
        <div
          className={`profit-banner ${f.fundingBalance < 0 ? "negative" : "positive"}`}
        >
          <span>
            {f.fundingBalance < 0
              ? "عجز متوقع لتغطية الالتزامات"
              : "فائض بعد الالتزامات المتوقعة"}
          </span>
          <strong>
            {amount(f.fundingBalance)} <small>ر.س</small>
          </strong>
        </div>
        <p className="small muted">
          الدخل المتوقع {amount(f.revenue)} − رواتب وتشغيل ومشتريات علف حسب
          التكرار {amount(f.plannedPayments)} ر.س. هذا تخطيط للدفع، مستقل عن
          تكلفة الاستهلاك والسداد الفعلي.
        </p>
        <div className="spread">
          <h2>التحصيل والمدفوعات المسجلة</h2>
          <span className="pill">حركة نقدية</span>
        </div>
        <div className="ledger">
          <span>التحصيل خلال الشهر</span>
          <b>{amount(f.collected)} ر.س</b>
          <span>مدفوعات الشهر الفعلية</span>
          <b>{amount(f.paid)} ر.س</b>
        </div>
        <div
          className={`profit-banner ${f.cashBalance < 0 ? "negative" : "positive"}`}
        >
          <span>
            {f.cashBalance < 0 ? "عجز نقدي مسجّل" : "فائض نقدي مسجّل"}
          </span>
          <strong>
            {amount(f.cashBalance)} <small>ر.س</small>
          </strong>
        </div>
        <p className="small muted">
          الفرق بين التحصيل والمدفوعات المسجلة فقط؛ لا يمثل رصيد البنك ولا يتضمن
          رصيدًا افتتاحيًا.
        </p>
        {!f.expensePaymentCount && (
          <p className="notice warning">
            لم يُسجّل سداد مصروفات لهذا الشهر. سجّل المدفوعات حتى يعكس الفرق
            النقدي واقعك.
          </p>
        )}
        <button className="button outline" onClick={() => onGo("expenses")}>
          تسجيل سداد مصروف <ArrowUpLeft size={16} />
        </button>
      </section>
      <section className="card">
        <div className="spread">
          <h2>المصروفات حسب التكرار</h2>
          <button className="text-button" onClick={() => onGo("expenses")}>
            التفاصيل
          </button>
        </div>
        <dl className="ledger">
          <dt>رواتب وتشغيل وخدمات</dt>
          <dd>{amount(f.other)} ر.س</dd>
          <dt>مشتريات علف</dt>
          <dd>{amount(f.purchases)} ر.س</dd>
          <dt>إجمالي الالتزامات المقدّرة</dt>
          <dd>{amount(f.plannedPayments)} ر.س</dd>
        </dl>
        <p className="small muted">
          خطط شراء العلف تغطيها فواتير الشراء لنفس الصنف؛ لا يجمع الاثنان مرتين.
          تكلفة التشغيل أعلاه تستخدم استهلاك كل خيل بدل إضافة قيمة الشراء مرة
          ثانية.
        </p>
        {f.unallocatedOperating > 0 && (
          <p className="warning small">
            تشمل تكلفة الإسطبل {amount(f.unallocatedOperating)} ر.س لم توزع على
            الخيل النشطة في هذه الفترة.
          </p>
        )}
      </section>
      <section className="card attention-card">
        <h2>يحتاج متابعة</h2>
        {f.incompleteCount > 0 && (
          <p className="warning">
            {displayNumber(f.incompleteCount)} خيل ببيانات تغذية غير مكتملة.
          </p>
        )}
        {f.lossCount > 0 && (
          <p className="value-negative">
            {displayNumber(f.lossCount)} خيل تكلفته أعلى من دخله.
          </p>
        )}
        {f.unpaidExpenseCount > 0 && (
          <p>{displayNumber(f.unpaidExpenseCount)} مصروفات لهذه الفترة لم يكتمل سدادها.</p>
        )}
        {f.horses
          .filter(
            (h) =>
              h.outstanding > 0 ||
              (h.active && (!h.complete || (!h.privateHorse && h.margin < 0))),
          )
          .slice(0, 5)
          .map((h) => (
            <button
              className="finance-followup"
              key={h.id}
              onClick={() => {
                if (showSaved) {
                  const savedDetail = document.getElementById(
                    `saved-horse-${h.id}`,
                  ) as HTMLDetailsElement | null;
                  if (savedDetail) {
                    savedDetail.open = true;
                    savedDetail.scrollIntoView({
                      behavior: "smooth",
                      block: "start",
                    });
                  }
                  return;
                }
                const row = state.horses.find((x) => x.id === h.id);
                if (row) onHorse(row);
              }}
            >
              <span>
                <b>{h.name}</b>
                <small>
                  {h.outstanding > 0
                    ? `متبقي ${amount(h.outstanding)} ر.س`
                    : !h.complete
                      ? "بيانات تكلفة ناقصة"
                      : `عجز ${amount(Math.abs(h.margin))} ر.س`}
                </small>
              </span>
              <ArrowUpLeft size={18} />
            </button>
          ))}
        {!f.incompleteCount &&
          !f.lossCount &&
          !f.outstanding &&
          !f.unpaidExpenseCount && (
            <p className="muted">لا توجد ملاحظات مالية في السجلات الحالية.</p>
          )}
      </section>
      <section className="card report-controls">
        <h2>تقرير الشهر</h2>
        <p className="small muted">
          احفظ نسخة من الأرقام وتفاصيل تكلفة الخيل للرجوع إليها بعد تغيير
          الأسعار.
        </p>
        {saved ? (
          <button
            className="button outline"
            onClick={() => setShowSaved(!showSaved)}
          >
            {showSaved ? "العودة للأرقام المباشرة" : "عرض التقرير المحفوظ"}
          </button>
        ) : (
          admin && (
            <button className="button outline" onClick={onSave}>
              حفظ تقرير {displayMonth(month)}
            </button>
          )
        )}
        {showSaved && (
          <p className="notice">
            أنت تعرض الأرقام المحفوظة وقت حفظ التقرير. العمليات التالية لا تغيّر
            هذه النسخة.
          </p>
        )}
        {showSaved &&
          f.horses.map((h) => (
            <details
              className="saved-horse"
              key={h.id}
              id={`saved-horse-${h.id}`}
            >
              <summary>
                {h.name} · تكلفة {amount(h.total)} ر.س
              </summary>
              <HorseFinancialPanel
                state={state}
                horse={h}
                month={month}
                staff
                figures={h}
              />
              {h.foodItems.map((item: any, i: number) => (
                <p className="small" key={i}>
                  {item.name}: {displayQuantity(item.quantity)} {item.unit}
                  {item.frequency === "monthly" ? "/مرة" : "/يوم"} ×{" "}
                  {displayPrice(item.rate)} × {displayNumber(item.count ?? h.days)}{" "}
                  {item.frequency === "monthly" ? "مرات بالشهر" : "يومًا"} ={" "}
                  {amount(item.amount)} ر.س
                </p>
              ))}
              {h.expenseItems.map((item, i) => (
                <p className="small" key={i}>
                  {item.name}: {amount(item.amount)} ر.س
                </p>
              ))}
            </details>
          ))}
      </section>
    </>
  );
}
