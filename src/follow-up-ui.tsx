import { ArrowUpLeft, CheckCircle2, ChevronLeft, ClipboardList, Package, Receipt, Wallet } from "lucide-react";
import type { CollectionFollowUp, FollowUpObservation, OperationalFollowUp } from "../functions/src/follow-up";
import { displayAmount, displayDate, displayMonth, displayNumber } from "./format";
import { TERMS } from "./terms";
import "./follow-up-ui.css";

export type TodayStockItem = {id:string;name:string;message:string};

function CollectionRows({rows, onHorse}:{rows:CollectionFollowUp[];onHorse:(id:string)=>void}) {
  return <div className="follow-up-rows">{rows.map(row=><button className="follow-up-row" key={row.horseId} onClick={()=>onHorse(row.horseId)}>
    <span><b>{row.horseName}</b><small>{row.ownerName || "فتح كشف الحساب"}</small></span>
    <strong>{displayAmount(row.amount)} <small>ر.س</small></strong><ChevronLeft size={17}/>
  </button>)}</div>;
}

export function TodayActions({followUp,stockItems=[],onHorse,onInventory,onRequests}:{
  followUp:OperationalFollowUp;
  stockItems?:TodayStockItem[];
  onHorse:(id:string)=>void;
  onInventory:(id:string)=>void;
  onRequests:()=>void;
}) {
  const {collections,pendingRequests}=followUp;
  const empty=!collections.dueToday.length&&!collections.overdue.length&&!stockItems.length&&!pendingRequests.length;
  return <section className="card follow-up-card today-actions" dir="rtl" aria-label="يحتاج إجراء اليوم">
    <header className="follow-up-heading"><div><p className="eyebrow">متابعة اليوم</p><h2>يحتاج إجراء اليوم</h2></div><time dateTime={followUp.today}>{displayDate(followUp.today)}</time></header>
    {empty?<p className="follow-up-empty"><CheckCircle2 size={19}/> لا توجد إجراءات مطلوبة اليوم حسب السجلات الحالية.</p>:<>
      {!!collections.dueToday.length&&<details className="follow-up-group"><summary><Wallet size={17}/><span>استحقاقات اليوم</span><b>{displayNumber(collections.dueToday.length)}</b><strong>{displayAmount(followUp.collectionTotals.dueToday)} <small>ر.س</small></strong></summary><CollectionRows rows={collections.dueToday} onHorse={onHorse}/></details>}
      {!!collections.overdue.length&&<details className="follow-up-group"><summary><Receipt size={17}/><span>تحصيل متأخر</span><b>{displayNumber(collections.overdue.length)}</b><strong>{displayAmount(followUp.collectionTotals.overdue)} <small>ر.س</small></strong></summary><CollectionRows rows={collections.overdue} onHorse={onHorse}/></details>}
      {!!stockItems.length&&<details className="follow-up-group"><summary><Package size={17}/><span>متابعة المخزون</span><b>{displayNumber(stockItems.length)}</b></summary><div className="follow-up-rows">{stockItems.map(item=><button key={item.id} className="follow-up-row" onClick={()=>onInventory(item.id)}><span><b>{item.name}</b><small>{item.message}</small></span><ChevronLeft size={17}/></button>)}</div></details>}
      {!!pendingRequests.length&&<button className="follow-up-request" onClick={onRequests}><ClipboardList size={18}/><span>طلبات خيل تحتاج متابعة <b>{displayNumber(pendingRequests.length)}</b></span><ArrowUpLeft size={18}/></button>}
    </>}
  </section>;
}

export function AccountReview({followUp,onObservation}:{followUp:OperationalFollowUp;onObservation:(observation:FollowUpObservation)=>void}) {
  const observations=followUp.observations;
  return <section className="card follow-up-card account-review" dir="rtl" aria-label="مراجعة بيانات الحسابات">
    <details className="follow-up-collapse"><summary className="follow-up-heading"><h2>مراجعة بيانات الحسابات</h2>{!!observations.length&&<span className="follow-up-count">{displayNumber(observations.length)}</span>}</summary>
    <p className="follow-up-description">ملاحظات تساعدك على استكمال بيانات حسابات الشهر.</p>
    {observations.length?<div className="follow-up-rows">{observations.map(item=><button className="follow-up-row review-observation" key={`${item.code}:${item.entity}:${item.id}`} onClick={()=>onObservation(item)}>
      <span><b>{item.name}</b><small>{item.message}</small></span><span className="follow-up-review-tag">للمراجعة</span><ChevronLeft size={17}/>
    </button>)}</div>:<p className="follow-up-empty"><CheckCircle2 size={19}/> لا توجد ملاحظات ظاهرة في فحوص البيانات الحالية.</p>}
    </details>
  </section>;
}

export function CashForecast({forecast}:{forecast:OperationalFollowUp["forecast"]}) {
  return <section className="card follow-up-card cash-forecast" dir="rtl" aria-label="توقع التحصيل والمدفوعات">
    <details className="follow-up-collapse"><summary className="follow-up-heading"><h2>توقع التحصيل والمدفوعات{!forecast.complete&&<small className="follow-up-incomplete-summary">تقدير غير مكتمل</small>}</h2><strong className={forecast.projectedMovement<0?"value-negative":"value-positive"}>{displayAmount(forecast.projectedMovement)} <small>ر.س</small></strong></summary>
    <p className="follow-up-description">حتى {displayDate(forecast.end)}</p>
    <p className="follow-up-description">إذا تم تحصيل المستحقات وسداد الالتزامات المعروفة حتى نهاية الشهر.</p>
    <div className={`follow-up-result ${forecast.projectedMovement<0?"negative":"positive"}`}><span>الفرق المتوقع بين التحصيل والمدفوعات</span><strong>{displayAmount(forecast.projectedMovement)} <small>ر.س</small></strong>{!forecast.complete&&<small>تقدير غير مكتمل؛ توجد بيانات تحتاج مراجعة.</small>}</div>
    <dl className="follow-up-amounts">
      <div><dt>{TERMS.cashDifference} حتى اليوم</dt><dd>{displayAmount(forecast.actual.net)} <small>ر.س</small></dd></div>
      <div><dt>يضاف: المتبقي على الملاك</dt><dd>{displayAmount(forecast.receivables.total)} <small>ر.س</small></dd></div>
      <div><dt>يخصم: مصروفات لم تُسدّد</dt><dd>{displayAmount(forecast.payables.total)} <small>ر.س</small></dd></div>
    </dl>
    <p className="follow-up-description">التقدير حسب المستحقات والمصروفات المسجلة؛ لا يشمل مشتريات جديدة لم تُسجّل، ولا يمثل رصيد البنك.</p>
    <details className="follow-up-details"><summary>تفاصيل التوقع</summary>
      <h3>التحصيل والمدفوعات الفعلية</h3>
      <p className="follow-up-description">من بداية {displayMonth(forecast.month)} حتى {displayDate(forecast.through)}.</p>
      <dl className="follow-up-amounts"><div><dt>{TERMS.collectedAmounts}</dt><dd>{displayAmount(forecast.actual.collected)} ر.س</dd></div><div><dt>المدفوعات المسجلة</dt><dd>{displayAmount(forecast.actual.paid)} ر.س</dd></div></dl>
      <h3>المتبقي على الملاك</h3>
      <dl className="follow-up-amounts">
        <div><dt>متأخرات من أشهر سابقة</dt><dd>{displayAmount(forecast.receivables.priorMonthArrears)} ر.س</dd></div>
        <div><dt>متأخر من الشهر الحالي</dt><dd>{displayAmount(forecast.receivables.overdueThisMonth)} ر.س</dd></div>
        <div><dt>مستحق اليوم</dt><dd>{displayAmount(forecast.receivables.dueToday)} ر.س</dd></div>
        <div><dt>استحقاقات قادمة حتى نهاية الشهر</dt><dd>{displayAmount(forecast.receivables.upcoming)} ر.س</dd></div>
      </dl>
      <p className="follow-up-description">المتبقي بعد احتساب الدفعات الجزئية والمقدمة، ويشمل الإيواء والمصروفات المطلوب استردادها من الملاك.</p>
      <h3>مصروفات لم تُسدّد</h3>
      {forecast.payables.rows.length?<div className="follow-up-payables">{forecast.payables.rows.map(row=><div key={`${row.period}:${row.expenseId}`}><span><b>{row.name}</b><small>{displayMonth(row.period)}{row.historical?" · فترة سابقة":""}</small></span><strong>{displayAmount(row.remaining)} <small>ر.س</small></strong></div>)}</div>:<p className="follow-up-description">لا توجد التزامات غير مسددة ضمن الفترات المعروفة.</p>}
      {!!forecast.missingHistoricalPeriods.length&&<p className="notice">توجد فترات سابقة دون حسابات محفوظة؛ يشمل التوقع الالتزامات السابقة المعروفة فقط.</p>}
      <p className="follow-up-description">شراء المخزون المسدّد داخل المدفوعات مرة واحدة. استهلاك التغذية لا يُخصم كدفعة أخرى. احتياج الشراء حتى يوم 27 يظهر في المخزون مستقلًا عن هذا التوقع.</p>
    </details></details>
  </section>;
}
