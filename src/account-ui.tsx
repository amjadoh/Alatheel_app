import { TERMS } from "./terms";
import { useRef, useState } from "react";
import type { State, Row } from "../functions/src/domain";
import {
  horseAccount,
  planPayment,
  accountRevision,
  isReceipt, preserveAccountCharges,
} from "../functions/src/accounts";
import { businessDay } from "../functions/src/dates";
import { displayAmount, displayDate, displayMonthName, isolateNumber } from "./format";
const money = displayAmount;
const monthName = displayMonthName;
const methods: Record<string, string> = {
  bank: "تحويل بنكي",
  cash: "نقدي",
  card: "شبكة",
  other: "أخرى",
};
export function ReceiptDetails({ receipt: r, onCorrect, onVoid }: {
  receipt: Row; onCorrect?: () => void; onVoid?: () => void;
}) {
  return (
    <details className="account-receipt">
      <summary>
        {displayDate(r.collectedAt)} · {money(r.amount)} ر.س · {r.horseName}
        {r.status === "void" ? " · ملغاة" : r.status === "replaced" ? " · تم تصحيحها" : r.cashAdjustment ? " · تسوية تصحيح" : ""}
      </summary>
      <p className="small muted">
        سند تحصيل {isolateNumber(String(r.id))} · {methods[r.method] || "طريقة غير مسجلة"}
      </p>
      {r.accountVersion ? (
        (r.allocations || []).map((x: any) => (
          <p className="small" key={x.id}>
            {x.kind === "boarding" ? monthName(x.dueDate.slice(0, 7)) : x.name}:{" "}
            {money(x.amount)} ر.س
          </p>
        ))
      ) : (
        <p className="small">
          الاستحقاق {displayDate(r.dueDate)} · إيواء {money(r.boardingFee ?? r.amount)} ر.س
        </p>
      )}
      {r.advanceAmount > 0 && (
        <p>رصيد مقدم وقت التسجيل: {money(r.advanceAmount)} ر.س</p>
      )}
      {!r.accountVersion &&
        r.expenseShares?.map((x: any) => (
          <p key={x.expenseId}>
            {x.name}: {money(x.amount)} ر.س
          </p>
        ))}
      {r.notes && <p>{r.notes}</p>}
      {r.correctsReceiptId && <p className="small">بديلة للسند {isolateNumber(r.correctsReceiptId)}</p>}
      {r.replacedBy && <p className="small">السند المصحح {isolateNumber(r.replacedBy)}</p>}
      {r.changeReason && <p className="small">سبب التغيير: {r.changeReason}</p>}
      {r.changedAt && <p className="small">بواسطة {r.changedByName || "المدير"} · {displayDate(r.changedAt)}</p>}
      {(r.reversalAt || r.cashRecognitionAt) && <p className="notice small">تسوية مرتبطة بالدفعة في {displayDate(r.reversalAt || r.cashRecognitionAt)}؛ تقرير الشهر المقفل يبقى كما حُفظ. هذه تسوية للسجل وليست حركة دفع جديدة.</p>}
      {isReceipt(r) && (onCorrect || onVoid) && <div className="account-types">
        {onCorrect && <button className="button outline" type="button" onClick={onCorrect}>تصحيح الدفعة</button>}
        {onVoid && <button className="button outline" type="button" onClick={onVoid}>إلغاء الدفعة</button>}
      </div>}
    </details>
  );
}
export function HorseAccount({
  state,
  horse,
  canPay,
  onPay,
  canModify = false,
  onChange,
}: {
  state: State;
  horse: Row;
  canPay: boolean;
  onPay: (data: Record<string, any>, requestId: string) => Promise<void>;
  canModify?: boolean;
  onChange?: (action: "income.correct" | "income.void", receiptId: string, data: Record<string, any>, requestId: string) => Promise<void>;
}) {
  const today = businessDay(new Date().toISOString()),
    [view, setView] = useState<"statement" | "pay">("statement"),
    [paymentType, setType] = useState("partial"),
    [paidAt, setDate] = useState(today),
    [amount, setAmount] = useState(""),
    [periods, setPeriods] = useState<string[]>([]),
    [method, setMethod] = useState("bank"),
    [notes, setNotes] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [editingId, setEditingId] = useState<string | null>(null),
    [voidId, setVoidId] = useState<string | null>(null),
    [reason, setReason] = useState("");
  const saving = useRef(false);
  const receiptRequest = useRef<string | null>(null);
  const editing = state.income.find(r => r.id === editingId);
  const paymentState = structuredClone(state);
  const paymentHorse = paymentState.horses.find(h => h.id === horse.id)!;
  if (editing) {
    preserveAccountCharges(paymentState, paymentHorse, today);
    paymentState.income.find(r => r.id === editing.id)!.status = "replaced";
  }
  const account = horseAccount(paymentState, paymentHorse, today),
    month = paidAt.slice(0, 7),
    validDate = /^\d{4}-\d{2}-\d{2}$/.test(paidAt),
    data = { paymentType, paidAt, amount, periods, method, notes };
  const validPeriods = periods.filter(
    (m) =>
      m < month &&
      account.items.some((x) => x.dueDate.slice(0, 7) === m && (editing || x.remaining > 0)),
  );
  const selectedData = { ...data, periods: validPeriods };
  const initialPlan = planPayment(paymentState, paymentHorse, selectedData, today);
  const chargedAmount =
    paymentType === "monthly" && !editing ? initialPlan.selectedBalance : Number(amount);
  const plan = planPayment(
    paymentState,
    paymentHorse,
    { ...selectedData, amount: chargedAmount },
    today,
  );
  const arrears = [
    ...new Set(
      account.items
        .filter((x) => (editing || x.remaining > 0) && x.dueDate.slice(0, 7) < month)
        .map((x) => x.dueDate.slice(0, 7)),
    ),
  ].sort();
  const balance = (m: string) =>
    Math.round(
      account.items
        .filter((x) => x.dueDate.slice(0, 7) === m)
        .reduce((n, x) => n + x.remaining, 0) * 100,
    ) / 100;
  const blocked =
    !validDate ||
    !Number.isFinite(chargedAmount) ||
    chargedAmount <= 0 ||
    paidAt > today ||
    (!!editing && !reason.trim()) ||
    (paymentType === "arrears" &&
      (!validPeriods.length || (!editing && chargedAmount > plan.selectedBalance)));
  function startCorrection(r: Row) {
    setEditingId(r.id); setVoidId(null); setView("pay"); setError(""); setReason("");
    setType(r.paymentType || "partial"); setDate(businessDay(r.collectedAt));
    setAmount(String(r.amount)); setMethod(r.method || "bank"); setNotes(r.notes || "");
    setPeriods([...new Set<string>((r.allocations || []).map((x: Row) => x.dueDate.slice(0, 7)))]);
    receiptRequest.current = null;
  }
  async function cancelReceipt(e: React.FormEvent) {
    e.preventDefault();
    if (saving.current || !voidId || !onChange || !reason.trim()) return;
    saving.current = true; setBusy(true); setError("");
    try {
      receiptRequest.current ||= crypto.randomUUID();
      await onChange("income.void", voidId, { reason, expectedRevision: accountRevision(state, horse) }, receiptRequest.current);
      setVoidId(null); setReason(""); receiptRequest.current = null;
    } catch(e) { setError(e instanceof Error ? e.message : "تعذر إلغاء الدفعة"); }
    finally { saving.current = false; setBusy(false); }
  }
  const selectMonths = (m: string, checked: boolean) => {
    const selected = checked
      ? [...new Set([...validPeriods, m])]
      : validPeriods.filter((x) => x !== m);
    setPeriods(selected);
    setAmount(
      String(
        Math.round(selected.reduce((n, x) => n + balance(x), 0) * 100) / 100,
      ),
    );
  };
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (saving.current || blocked) return;
    saving.current = true;
    setBusy(true);
    setError("");
    try {
      receiptRequest.current ||= crypto.randomUUID();
      const commandData = {
          ...selectedData,
          amount: chargedAmount,
          expectedRevision: accountRevision(state, horse),
          ...(editing ? { reason } : {}),
        };
      if (editing && canModify && onChange) await onChange("income.correct", editing.id, commandData, receiptRequest.current);
      else await onPay(commandData, receiptRequest.current);
      receiptRequest.current = null;
      setView("statement");
      setEditingId(null); setReason("");
      setAmount("");
      setPeriods([]);
      setNotes("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذر تسجيل الدفعة");
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  if (
    horse.status === "private" ||
    (horse.status === "archived" && horse.previousStatus === "private")
  )
    return (
      <div className="notice">
        خيل ملك خاص؛ تتابع تكلفته من ملف الخيل دون تحصيل على المالك.
      </div>
    );
  return (
    <div className="horse-account">
      <p className="eyebrow">
        {horse.name} · {horse.ownerName}
      </p>
      <div className="tabs">
        <button
          className={view === "statement" ? "selected" : ""}
          disabled={busy}
          onClick={() => { setView("statement"); setEditingId(null); setError(""); }}
        >
          كشف الحساب
        </button>
        {canPay && (
          <button
            className={view === "pay" ? "selected" : ""}
            disabled={busy}
            onClick={() => { setView("pay"); setEditingId(null); setVoidId(null); setReason(""); setAmount(""); setDate(today); setType("partial"); setMethod("bank"); setPeriods([]); setNotes(""); setError(""); receiptRequest.current = null; }}
          >
            تسجيل دفعة
          </button>
        )}
      </div>
      {view === "statement" ? (
        <>
          <div className="account-balance">
            <span>المتبقي على المالك</span>
            <div className="big-number">
              {money(account.outstanding)} <small>ر.س</small>
            </div>
            <p>رصيد مقدم: {money(account.credit)} ر.س</p>
            <dl className="ledger">
              <dt>متأخرات الأشهر السابقة</dt>
              <dd>{money(account.arrears)} ر.س</dd>
              <dt>مستحق هذا الشهر حتى اليوم</dt>
              <dd>{money(account.dueNow)} ر.س</dd>
              <dt>يستحق لاحقًا هذا الشهر</dt>
              <dd>{money(account.upcoming)} ر.س</dd>
            </dl>
            <small>
              الاستحقاقات حتى نهاية {monthName(today.slice(0, 7))} · دفعات
              المالك حتى {displayDate(today)}
            </small>
          </div>
          <div className="account-totals">
            <span>
              مستحق مسجل <b>{money(account.charged)}</b>
            </span>
            <span>
              محصل من المالك <b>{money(account.paid)}</b>
            </span>
          </div>
          {!horse.accountVersion && (
            <p className="notice small">
              السجل يجمع التحصيلات السابقة والاستحقاقات من موعد الاستحقاق
              الحالي. لا نفترض ديونًا قبل هذا الموعد بلا سجل. الدفعات المستلمة
              خارج التطبيق تحتاج تسجيلها بتاريخها الصحيح.
            </p>
          )}
          <h3>الاستحقاقات وتوزيع دفعات المالك</h3>
          {account.items.length ? (
            account.items.map((x) => (
              <div className="account-cycle" key={x.id}>
                <div className="spread">
                  <b>
                    {x.kind === "boarding"
                      ? monthName(x.dueDate.slice(0, 7))
                      : x.name}
                  </b>
                  <span className={`pill ${x.remaining ? "red" : ""}`}>
                    {x.remaining ? (x.paid ? "مسدد جزئيًا" : "مستحق") : "مسدد"}
                  </span>
                </div>
                <p className="small">
                  الاستحقاق {displayDate(x.dueDate)} · القيمة {money(x.amount)} ر.س
                </p>
                <p className="small">
                  محصل {money(x.paid)} · متبقي {money(x.remaining)} ر.س
                </p>
              </div>
            ))
          ) : (
            <p>لا توجد استحقاقات مسجلة.</p>
          )}
          <h3>سجل دفعات المالك</h3>
          {(canModify ? state.income.filter(r => r.horseId === horse.id && r.status !== "pending") : account.receipts).length ? (
            (canModify ? state.income.filter(r => r.horseId === horse.id && r.status !== "pending").slice().sort((a,b) => String(b.createdAt || b.collectedAt).localeCompare(String(a.createdAt || a.collectedAt))) : account.receipts).map((r) => (
              <ReceiptDetails key={r.id} receipt={r}
                onCorrect={canModify && onChange && !busy ? () => startCorrection(r) : undefined}
                onVoid={canModify && onChange && !busy ? () => { setVoidId(r.id); setReason(""); setError(""); receiptRequest.current = null; } : undefined} />
            ))
          ) : (
            <p>لا توجد دفعات مسجلة لهذا الخيل.</p>
          )}
          {voidId && <form onSubmit={e => void cancelReceipt(e)} aria-label="تأكيد إلغاء الدفعة">
            <fieldset disabled={busy}>
              <legend>إلغاء الدفعة</legend>
              <p>سيُستبعد مبلغ {money(state.income.find(r => r.id === voidId)?.amount || 0)} ر.س من التحصيل، ويُعاد حساب المتبقي والرصيد المقدم فورًا. يبقى السند في سجل المدير ولا يتطلب إجراءً بعد الإلغاء.</p>
              <label className="field"><span>سبب الإلغاء</span><textarea required maxLength={500} value={reason} onChange={e => setReason(e.target.value)} /></label>
              {error && <p role="alert">{error}</p>}
              <button className="button gold" disabled={busy || !reason.trim()}>تأكيد إلغاء الدفعة</button>
              <button className="button outline" type="button" onClick={() => { setVoidId(null); setError(""); }}>رجوع</button>
            </fieldset>
          </form>}
        </>
      ) : (
        <form onSubmit={(e) => void submit(e)}>
          <fieldset disabled={busy}>
            {editing && <div className="notice"><b>تصحيح الدفعة · {money(editing.amount)} ر.س</b><p>يُحفظ السند الأصلي وتُسجل نسخة مصححة مرتبطة به. إذا كان تاريخ التحصيل في شهر مقفل، تُسجل تسويته في الشهر الحالي.</p><label className="field"><span>سبب التصحيح</span><textarea required maxLength={500} value={reason} onChange={e => setReason(e.target.value)} /></label></div>}
            <legend>نوع الدفعة</legend>
            <div className="account-types">
              {[
                ["partial", "دفع جزئي"],
                ["monthly", "دفع استحقاق الشهر"],
                ["arrears", "دفع متأخرات"],
              ].map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  className={`button ${paymentType === key ? "gold" : "outline"}`}
                  aria-pressed={paymentType === key}
                  onClick={() => {
                    setType(key);
                    setError("");
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            <label className="field">
              <span>{TERMS.collectionDate}</span>
              <input
                type="date"
                value={paidAt}
                min={horse.entryDate || undefined}
                max={today}
                required
                onChange={(e) => {
                  setDate(e.target.value);
                  setPeriods([]);
                }}
              />
            </label>
            {paymentType === "monthly" && validDate && (
              <p className="notice">
                استحقاق {monthName(month)} · يحدد من تاريخ التحصيل. المتبقي:{" "}
                {money(plan.selectedBalance)} ر.س
              </p>
            )}
            {paymentType === "arrears" && (
              <div className="notice">
                <b>الأشهر السابقة غير المسددة</b>
                {arrears.length ? (
                  arrears.map((m) => (
                    <label className="check-field" key={m}>
                      <input
                        type="checkbox"
                        checked={validPeriods.includes(m)}
                        onChange={(e) => selectMonths(m, e.target.checked)}
                      />
                      <span>
                        {monthName(m)} · {money(balance(m))} ر.س
                      </span>
                    </label>
                  ))
                ) : (
                  <p>لا توجد متأخرات قبل شهر تاريخ التحصيل.</p>
                )}
              </div>
            )}
            <label className="field">
              <span>المبلغ المستلم (ريال)</span>
              <input
                type="number"
                min="0.01"
                step="0.01"
                max={paymentType === "arrears" && !editing ? plan.selectedBalance : 1000000}
                required
                readOnly={paymentType === "monthly" && !editing}
                value={paymentType === "monthly" && !editing ? chargedAmount : amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </label>
            {paymentType === "partial" && (
              <p className="small muted">
                يوزع على الأقدم حتى شهر تاريخ التحصيل، والزيادة رصيد مقدم
                يُستخدم عند حلول الاستحقاقات.
              </p>
            )}
            {paymentType === "arrears" && (
              <p className="small muted">
                حدد الأشهر ثم عدّل المبلغ إذا كان السداد أقل من مجموعها؛ يتوزع
                على الأقدم من الأشهر المحددة.
              </p>
            )}
            <label className="field">
              <span>{TERMS.collectionMethod}</span>
              <select
                value={method}
                onChange={(e) => setMethod(e.target.value)}
              >
                {Object.entries(methods).map(([v, n]) => (
                  <option key={v} value={v}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>ملاحظة أو مرجع الحوالة (اختياري)</span>
              <input
                value={notes}
                maxLength={500}
                onChange={(e) => setNotes(e.target.value)}
              />
            </label>
            {Number.isFinite(chargedAmount) && chargedAmount > 0 && (
              <div className="notice" aria-live="polite">
                <b>توزيع الدفعة قبل الحفظ</b>
                {plan.allocations.map((x) => (
                  <p className="small" key={x.id}>
                    {x.kind === "boarding"
                      ? monthName(x.dueDate.slice(0, 7))
                      : x.name}
                    : {money(x.amount)} ر.س
                    {x.amount <
                    (account.items.find((i) => i.id === x.id)?.remaining || 0)
                      ? " · سداد جزئي"
                      : ""}
                  </p>
                ))}
                {plan.advance > 0 && (
                  <p>رصيد مقدم: {money(plan.advance)} ر.س</p>
                )}
                {paymentType === "arrears" && (
                  <p>
                    متبقي الأشهر المحددة:{" "}
                    {money(Math.max(0, plan.selectedBalance - chargedAmount))}{" "}
                    ر.س
                  </p>
                )}
                <p>إجمالي المتبقي على المالك: {money(plan.remaining)} ر.س</p>
              </div>
            )}
            {error && (
              <p role="alert" className="notice">
                {error}
              </p>
            )}
            <button
              className="button gold"
              disabled={busy || blocked}
              type="submit"
            >
              {busy ? "جارٍ الحفظ…" : editing ? "حفظ تصحيح الدفعة" : "تأكيد استلام المبلغ"}
            </button>
          </fieldset>
        </form>
      )}
    </div>
  );
}
