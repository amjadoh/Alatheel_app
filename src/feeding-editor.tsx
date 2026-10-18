import { feedingMeasure, feedingUnitPrice, scheduledFeedingDates } from "../functions/src/feeding";
import type { Row } from "../functions/src/domain";
import { displayAmount, displayDate, displayMonth, displayNumber, displayQuantity } from "./format";
import "./feeding-editor.css";

const weekdays = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
const ordinals = ["الأول", "الثاني", "الثالث", "الرابع"];
const blankSlot = () => ({ weekday: "", ordinal: "" });
const isSlot = (slot: any) => slot && slot.weekday !== "" && slot.ordinal !== "" &&
  Number.isInteger(Number(slot.weekday)) && Number(slot.weekday) >= 0 && Number(slot.weekday) <= 6 &&
  Number.isInteger(Number(slot.ordinal)) && Number(slot.ordinal) >= 1 && Number(slot.ordinal) <= 4;

export function feedingFormError(plans: any[]) {
  const ids = plans.map((plan) => plan.mealTypeId);
  if (new Set(ids).size !== ids.length) return "الصنف مكرر في برنامج التغذية؛ اجمع كميته في خطة واحدة.";
  for (const plan of plans) {
    if (plan.frequency !== "monthly" || !Array.isArray(plan.schedule)) continue;
    const count = Number(plan.timesPerMonth);
    if (!Number.isInteger(count) || count < 1 || count > 28 || plan.schedule.length !== count || !plan.schedule.every(isSlot))
      return "أكمل اليوم وترتيبه لكل موعد تغذية بالشهر.";
    if (new Set(plan.schedule.map((slot: any) => `${Number(slot.weekday)}:${Number(slot.ordinal)}`)).size !== count)
      return "يوجد موعد تغذية مكرر؛ اختر موعدًا مختلفًا لكل مرة.";
  }
  return "";
}

export function FeedingPlanSummary({ plan, meal, month }: { plan: any; meal: Row; month: string }) {
  const monthly = plan.frequency === "monthly";
  const scheduled = !monthly || (Array.isArray(plan.schedule) && !feedingFormError([plan]));
  const dates = scheduled ? scheduledFeedingDates(plan, month) : [];
  return <div className="feeding-plan-summary">
    <p><b>{meal.name || "صنف تغذية"}</b> · {displayQuantity(plan.quantity)} {feedingMeasure(meal).unit} {monthly ? "في المرة" : "يوميًا"}</p>
    {monthly && <p className="small muted">{displayNumber(plan.timesPerMonth)} {Number(plan.timesPerMonth) === 1 ? "مرة بالشهر" : "مرات بالشهر"}{scheduled && <> · {plan.schedule.map((slot: any) => `${weekdays[Number(slot.weekday)]} ${ordinals[Number(slot.ordinal) - 1]}`).join("، ")}</>}</p>}
    {!scheduled && <p className="notice warning small">خطة سابقة بعدد مرات فقط؛ تكلفتها تقديرية. حدد مواعيدها من «تعديل بيانات الخيل» لتفعيل الخصم التلقائي لهذا الصنف.</p>}
    {scheduled && monthly && <p className="small muted">مواعيد {displayMonth(month)}: {dates.map(displayDate).join("، ")}</p>}
  </div>;
}

export function FeedingEditor({ plans, meals, month, onChange }: { plans: any[]; meals: Row[]; month: string; onChange: (plans: any[]) => void }) {
  return <fieldset className="feeding-editor">
    <legend>برنامج التغذية</legend>
    <p className="muted small">حدد كمية اليوم، أو كمية المرة ومواعيدها بالشهر. يبدأ خصم المخزون بعد تأكيد رصيده وتفعيل الخصم للصنف. الشراء يسجل مدفوعاته مرة واحدة، وخصم التغذية حركة كمية فقط.</p>
    {plans.map((plan, i) => {
      const change = (values: Record<string, any>) => onChange(plans.map((current, j) => i === j ? { ...current, ...values } : current));
      const meal = meals.find((item) => item.id === plan.mealTypeId) || { id: "", name: "" };
      const monthly = plan.frequency === "monthly";
      const legacy = monthly && !Array.isArray(plan.schedule);
      const count = Number(plan.timesPerMonth || 1);
      const mode = monthly ? count === 1 ? "once" : "monthly" : "daily";
      const dates = !legacy && !feedingFormError([plan]) ? scheduledFeedingDates(plan, month) : [];
      const setCount = (raw: string | number) => {
        const next = Number(raw);
        change({ timesPerMonth: raw, schedule: Number.isInteger(next) && next >= 1 && next <= 28 ? Array.from({ length: next }, (_, slot) => plan.schedule?.[slot] || blankSlot()) : [] });
      };
      return <div className="feeding-item" key={i}>
        <h4>خطة التغذية {displayNumber(i + 1)}</h4>
        <label className="field"><span>الصنف</span><select aria-label={`نوع التغذية ${i + 1}`} required value={plan.mealTypeId} onChange={(e) => change({ mealTypeId: e.target.value })}>
          {!meal.id && <option value="">اختر الصنف</option>}
          {meals.map((item) => <option key={item.id} value={item.id}>{item.name} ({feedingMeasure(item).unit})</option>)}
        </select></label>
        <label className="field"><span>التكرار</span><select aria-label={`تكرار التغذية ${i + 1}`} value={mode} onChange={(e) => {
          if (e.target.value === "daily") change({ frequency: "daily", timesPerMonth: undefined, schedule: undefined });
          else {
            const next = e.target.value === "once" ? 1 : Math.max(2, Math.min(28, count));
            change({ frequency: "monthly", timesPerMonth: next, schedule: Array.from({ length: next }, (_, slot) => plan.schedule?.[slot] || blankSlot()) });
          }
        }}><option value="daily">يوميًا</option><option value="once">مرة بالشهر</option><option value="monthly">عدة مرات بالشهر</option></select></label>
        <label className="field"><span>{monthly ? "الكمية في المرة" : "إجمالي كمية اليوم"} ({feedingMeasure(meal).unit})</span><input type="number" min="0.001" step="0.001" required aria-label={`كمية التغذية ${i + 1}`} value={plan.quantity} onChange={(e) => change({ quantity: e.target.value })} /></label>
        {monthly && count !== 1 && <label className="field"><span>عدد المرات بالشهر</span><input type="number" min="2" max={legacy ? "1000" : "28"} step="1" required aria-label={`عدد مرات التغذية ${i + 1}`} value={plan.timesPerMonth ?? ""} onChange={(e) => setCount(e.target.value)} /></label>}
        {legacy ? <div className="notice warning small"><p>هذه خطة سابقة دون أيام محددة. لا يخصم المخزون لها تلقائيًا حتى تحدد المواعيد. تظل الكمية والتكلفة التقديرية محفوظتين.</p><button type="button" className="button outline" onClick={() => setCount(Math.max(1, Math.min(28, count)))}>تحديد مواعيد الخصم</button></div> : monthly && <div className="feeding-slots">
          <p className="small muted">اختر اليوم وترتيبه داخل الشهر لكل موعد؛ مثال: السبت الأول والسبت الثالث. أول أربعة تكرارات متاحة دائمًا في كل شهر.</p>
          {(plan.schedule || []).map((slot: any, j: number) => {
            const setSlot = (value: Record<string, any>) => change({ schedule: plan.schedule.map((current: any, index: number) => index === j ? { ...current, ...value } : current) });
            return <div className="feeding-slot" key={j}>
              <b>الموعد {displayNumber(j + 1)}</b>
              <label className="field"><span>اليوم</span><select required aria-label={`يوم التغذية ${i + 1} موعد ${j + 1}`} value={slot.weekday} onChange={(e) => setSlot({ weekday: e.target.value === "" ? "" : Number(e.target.value) })}><option value="">اختر اليوم</option>{weekdays.map((day, weekday) => <option key={day} value={weekday}>{day}</option>)}</select></label>
              <label className="field"><span>ترتيبه بالشهر</span><select required aria-label={`ترتيب التغذية ${i + 1} موعد ${j + 1}`} value={slot.ordinal} onChange={(e) => setSlot({ ordinal: e.target.value === "" ? "" : Number(e.target.value) })}><option value="">اختر الترتيب</option>{ordinals.map((ordinal, index) => <option key={ordinal} value={index + 1}>{ordinal}</option>)}</select></label>
            </div>;
          })}
        </div>}
        {!!dates.length && <div className="notice small" aria-live="polite"><b>معاينة شهر كامل · {displayMonth(month)}</b><p>{displayNumber(dates.length)} {monthly ? "مرة" : "يومًا"} · استهلاك {displayQuantity(dates.length * Number(plan.quantity || 0))} {feedingMeasure(meal).unit} · تكلفة تقديرية {displayAmount(dates.length * Number(plan.quantity || 0) * feedingUnitPrice(meal))} ر.س</p>{monthly && <p>المواعيد: {dates.map(displayDate).join("، ")}</p>}<p className="muted">الخصم الفعلي يراعي أيام الإقامة، تاريخ تفعيل الصنف والوجبات المتخطاة.</p></div>}
        <button type="button" className="button outline" onClick={() => onChange(plans.filter((_, j) => i !== j))}>إزالة الصنف</button>
      </div>;
    })}
    <button type="button" className="button outline" disabled={!meals.length} onClick={() => onChange([...plans, { mealTypeId: meals[0]?.id, quantity: 1, frequency: "daily" }])}>إضافة نوع تغذية</button>
  </fieldset>;
}
