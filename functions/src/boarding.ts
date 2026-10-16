import type { Row } from "./domain";
import { money } from "./domain";
import { businessDay } from "./dates";

export function stayDays(h: Row, month: string) {
  const [y, m] = month.split("-").map(Number),
    last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  if (h.stayPeriods?.length) {
    const days = new Set<number>();
    for (const period of h.stayPeriods) {
      const from = [month + "-01", businessDay(period.entryDate)].sort().pop()!;
      const until = [last, businessDay(period.exitDate) || last].sort()[0];
      for (let d = Date.parse(from); d <= Date.parse(until); d += 86400000)
        days.add(d);
    }
    return days.size;
  }
  const first = [month + "-01", businessDay(h.entryDate) || month + "-01"]
    .sort()
    .pop()!;
  const end = [last, businessDay(h.exitDate) || last].sort()[0];
  return first > end
    ? 0
    : Math.round((Date.parse(end) - Date.parse(first)) / 86400000) + 1;
}
export function boardingTerms(h: Row, month: string) {
  const history = (h.boardingHistory || [])
    .filter((v: Row) => v.month <= month)
    .sort((a: Row, b: Row) => a.month.localeCompare(b.month));
  const v = history[history.length - 1];
  return {
    fee: Number(v?.fee ?? h.boardingFee ?? 0),
    policy: v?.policy || h.billingPolicy || "full_month",
  };
}
export function boardingAmount(
  h: Row,
  month: string,
  fee?: number,
  policy?: string,
) {
  const frozen =
    fee === undefined
      ? h.accountCycles?.find((c: Row) => c.dueDate.slice(0, 7) === month)
      : undefined;
  const terms = boardingTerms(h, month),
    rate = fee ?? frozen?.baseFee ?? frozen?.amount ?? terms.fee;
  const days = stayDays(h, month),
    [y, m] = month.split("-").map(Number);
  return money(
    !days
      ? 0
      : (policy || frozen?.billingPolicy || terms.policy) === "per_day"
        ? (rate * days) / new Date(Date.UTC(y, m, 0)).getUTCDate()
        : rate,
  );
}
