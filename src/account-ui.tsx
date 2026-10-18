import { TERMS } from "./terms";
import { useRef, useState } from "react";
import type { State, Row } from "../functions/src/domain";
import {
  horseAccount,
  planPayment,
  accountRevision,
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
export function ReceiptDetails({ receipt: r }: { receipt: Row }) {
  return (
    <details className="account-receipt">
      <summary>
        {displayDate(r.collectedAt)} · {money(r.amount)} ر.س · {r.horseName}
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
    </details>
  );
}
export function HorseAccount({
  state,
  horse,
  canPay,
  onPay,
}: {
  state: State;
  horse: Row;
  canPay: boolean;
  onPay: (data: Record<string, any>, requestId: string) => Promise<void>;
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
    [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const receiptRequest = useRef<string | null>(null);
  const account = horseAccount(state, horse, today),
    month = paidAt.slice(0, 7),
    validDate = /^\d{4}-\d{2}-\d{2}$/.test(paidAt),
    data = { paymentType, paidAt, amount, periods, method, notes };
  const validPeriods = periods.filter(
    (m) =>
      m < month &&
      account.items.some((x) => x.dueDate.slice(0, 7) === m && x.remaining > 0),
  );
  const selectedData = { ...data, periods: validPeriods };
  const initialPlan = planPayment(state, horse, selectedData, today);
  const chargedAmount =
    paymentType === "monthly" ? initialPlan.selectedBalance : Number(amount);
  const plan = planPayment(
    state,
    horse,
    { ...selectedData, amount: chargedAmount },
    today,
  );
  const arrears = [
    ...new Set(
      account.items
        .filter((x) => x.remaining > 0 && x.dueDate.slice(0, 7) < month)
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
    (paymentType === "arrears" &&
      (!validPeriods.length || chargedAmount > plan.selectedBalance));
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
      await onPay(
        {
          ...selectedData,
          amount: chargedAmount,
          expectedRevision: accountRevision(state, horse),
        },
        receiptRequest.current,
      );
      receiptRequest.current = null;
      setView("statement");
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
          onClick={() => setView("statement")}
        >
          كشف الحساب
        </button>
        {canPay && (
          <button
            className={view === "pay" ? "selected" : ""}
            disabled={busy}
            onClick={() => setView("pay")}
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
          {account.receipts.length ? (
            account.receipts.map((r) => (
              <ReceiptDetails key={r.id} receipt={r} />
            ))
          ) : (
            <p>لا توجد دفعات مسجلة لهذا الخيل.</p>
          )}
        </>
      ) : (
        <form onSubmit={(e) => void submit(e)}>
          <fieldset disabled={busy}>
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
                max={paymentType === "arrears" ? plan.selectedBalance : 1000000}
                required
                readOnly={paymentType === "monthly"}
                value={paymentType === "monthly" ? chargedAmount : amount}
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
              {busy ? "جارٍ التسجيل…" : "تأكيد استلام المبلغ"}
            </button>
          </fieldset>
        </form>
      )}
    </div>
  );
}
