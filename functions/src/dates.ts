/** Dates without time are business dates; timestamps are viewed in Riyadh. */
export function purchasePeriod(value: unknown) {
  const day = businessDay(value);
  if (!day) return "";
  if (Number(day.slice(8, 10)) <= 27) return day.slice(0, 7);
  const [year, month] = day.split("-").map(Number);
  return `${year + (month === 12 ? 1 : 0)}-${String(month === 12 ? 1 : month + 1).padStart(2, "0")}`;
}

export function businessDay(value: unknown) {
  const text = String(value || "");
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const parsed = new Date(text);
  if (!text || !Number.isFinite(parsed.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Riyadh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(parsed);
}
