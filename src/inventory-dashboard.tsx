import type { InventoryNeeds, ItemNeeds } from "../functions/src/inventory-needs";
import type { ItemRunway } from "../functions/src/inventory-runway";
import { displayAmount, displayDate, displayNumber, displayQuantity } from "./format";

export function InventoryDashboard({ needs }: { needs: InventoryNeeds }) {
  return <section className="inventory-dashboard" aria-label="ملخص احتياج المخزون">
    <div className="inventory-period"><span>احتياج التغذية المتبقي</span><h2>{displayDate(needs.today)} — {displayDate(needs.end)}</h2><small>الدورة الشهرية: {displayDate(needs.start)} — {displayDate(needs.end)}</small></div>
    <div className="inventory-metrics"><div><span>أصناف تحتاج شراء</span><strong>{displayNumber(needs.needCount)} <small>من أصل {displayNumber(needs.items.length)}</small></strong></div><div><span>الشراء المتوقع</span><strong>{displayAmount(needs.cost)} <small>ر.س</small></strong>{(needs.missingPrices || needs.incomplete) && <small>تقدير غير مكتمل</small>}</div></div>
    {needs.incomplete && <p className="notice">بعض برامج التغذية تحتاج تحديد المواعيد؛ الاحتياج المعروض يشمل الوجبات المجدولة فقط.</p>}
    {needs.missingPrices && <p className="notice">أكمل سعر الأصناف الناقصة لحساب قيمة الشراء المتوقعة.</p>}
  </section>;
}

export function InventoryRunwayPanel({ item, today, horizonEnd, name="الصنف" }: { item: ItemRunway; today: string; horizonEnd: string; name?:string }) {
  const incomplete=item.incomplete,empty=item.emptyNow,covered=item.lastCoveredDate||horizonEnd;
  return <section className={`inventory-runway ${incomplete||empty||item.stockoutDate&&item.stockoutDate<=today ? "short" : ""}`} aria-label="مدة توفر الصنف">
    <h3>{incomplete?`أكمل بيانات ${name} لحساب مدة توفره`:empty?`${name} غير متوفر حاليًا`:item.status==="no_consumption"?`لا يوجد استهلاك مجدول لـ${name}`:item.stockoutDate&&item.stockoutDate<=today?`${name} لا يكفي كمية التغذية المجدولة اليوم`:<>{name} متوفر حتى {displayDate(covered)}{item.status==="beyond_horizon"?" على الأقل":""}</>}</h3>
    <p className="small muted">حسب الكمية الحالية ومواعيد تغذية الخيل المسجلة.</p>
  </section>;
}

export function InventoryItemNeeds({ item, end }: { item: ItemNeeds; end: string }) {
  const coverage = item.remaining > 0 ? Math.max(0, Math.min(100, item.available / item.remaining * 100)) : item.available >= 0 ? 100 : 0;
  return <div className="inventory-need" aria-label="احتياج التغذية للصنف">
    <div className="inventory-quantities"><div><span>المتوفر الآن</span><strong>{displayQuantity(item.stock)} <small>{item.unit}</small></strong></div><div><span>المطلوب حتى {displayDate(end)}</span><strong>{displayQuantity(item.remaining)} <small>{item.unit}</small></strong></div></div>
    <div className="inventory-coverage" role="progressbar" aria-label="تغطية احتياج التغذية" aria-valuenow={Math.round(coverage)} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${coverage}%` }}/></div>
    {item.pending > 0 && <p className="notice small">محجوز لخصم سابق لم يكتمل: {displayQuantity(item.pending)} {item.unit}. المتاح للاحتياج القادم: {displayQuantity(item.available)} {item.unit}.</p>}
    {item.shortage>0&&<div className="inventory-shortage short"><span>الناقص للشراء</span><strong>{displayQuantity(item.shortage)} {item.unit}</strong></div>}
    <details className="inventory-breakdown"><summary>التفاصيل واستهلاك الخيل</summary>
      <dl><div><dt>احتياج الدورة المجدول</dt><dd>{displayQuantity(item.cycleQuantity)} {item.unit}</dd></div>
      {item.conversion !== 1 && <div><dt>يعادل للشراء</dt><dd>{displayQuantity(item.purchaseQuantity)} {item.purchaseUnit}</dd></div>}
      <div><dt>قيمة الناقص التقديرية</dt><dd>{item.cost === undefined && item.shortage > 0 ? "السعر غير مسجل" : `${displayAmount(item.cost || 0)} ر.س`}</dd></div></dl>
      {item.horses.map(h => <div className="inventory-horse" key={h.id}><div><b>{h.name}</b><strong>{displayQuantity(h.quantity)} {item.unit}</strong></div><small>{displayNumber(h.dates.length)} موعدًا متبقيًا · {h.dates.length > 4 ? `${displayDate(h.dates[0])} — ${displayDate(h.dates.at(-1))}` : h.dates.map(displayDate).join("، ")}</small></div>)}
      {!!item.unscheduled.length && <p className="notice small">مواعيد غير محددة: {item.unscheduled.join("، ")}. لم تُدرج كمياتها في الاحتياج.</p>}
      {!item.horses.length && !item.unscheduled.length && <p className="muted small">لا توجد وجبات متبقية لهذا الصنف حتى نهاية الفترة.</p>}
      <p className="muted small">يشمل المواعيد المتبقية حتى نهاية يوم 27، ويستبعد الأيام المخصومة والوجبات المتخطاة. قيمة الشراء حسب آخر سعر؛ لا تسجل كمصروف إلا عند الشراء.</p>
    </details>
  </div>;
}
