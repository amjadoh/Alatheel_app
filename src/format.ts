// Keep storage, calculations and input values numeric. Isolation belongs only to display text.
const LRI = "\u2066";
const PDI = "\u2069";
const locale = "en-US-u-nu-latn";
const timeZone = "Asia/Riyadh";
const missing = "—";

function finiteNumber(value: unknown): number | undefined {
  if (
    typeof value !== "number" &&
    !(typeof value === "string" && value.trim() !== "")
  )
    return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function numeric(
  value: unknown,
  minimumFractionDigits: number,
  maximumFractionDigits: number,
): string {
  const number = finiteNumber(value);
  if (number === undefined) return missing;
  const text = new Intl.NumberFormat(locale, {
    useGrouping: true,
    minimumFractionDigits,
    maximumFractionDigits,
  }).format(number);
  // A rounded loss of less than half a halala must not be shown as negative zero.
  return /^-0(?:\.0+)?$/.test(text) ? text.slice(1) : text;
}

/** Plain Western digits for file content or other non-UI output. */
export const formatAmount = (value: unknown): string => numeric(value, 2, 2);
export const formatNumber = (value: unknown): string => numeric(value, 0, 8);
export const formatQuantity = (value: unknown): string => numeric(value, 0, 8);
export const formatPrice = (value: unknown): string => numeric(value, 2, 8);
export const formatPercent = (value: unknown): string =>
  `${numeric(value, 0, 2)}${finiteNumber(value) === undefined ? "" : "%"}`;

/** Isolate the sign, grouping and decimal point from the surrounding Arabic. */
export const isolateNumber = (text: string): string =>
  text === missing ? text : `${LRI}${text}${PDI}`;

export const displayAmount = (value: unknown): string =>
  isolateNumber(formatAmount(value));
export const displayNumber = (value: unknown): string =>
  isolateNumber(formatNumber(value));
export const displayQuantity = (value: unknown): string =>
  isolateNumber(formatQuantity(value));
export const displayPrice = (value: unknown): string =>
  isolateNumber(formatPrice(value));
export const displayPercent = (value: unknown): string =>
  isolateNumber(formatPercent(value));

function dateValue(value: unknown): Date | undefined {
  if (typeof value !== "string" || !value) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const date = new Date(`${value}T12:00:00Z`);
    return Number.isFinite(date.valueOf()) &&
      date.toISOString().slice(0, 10) === value
      ? date
      : undefined;
  }
  // Persisted timestamps carry an explicit offset; never interpret a local wall clock.
  if (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(value))
    return undefined;
  const date = new Date(value);
  return Number.isFinite(date.valueOf()) ? date : undefined;
}

export function formatDate(value: unknown): string {
  const date = dateValue(value);
  return date
    ? new Intl.DateTimeFormat("en-GB-u-ca-gregory-nu-latn", {
        timeZone,
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      }).format(date)
    : missing;
}

function monthDate(value: unknown): Date | undefined {
  return typeof value === "string" && /^\d{4}-\d{2}$/.test(value)
    ? dateValue(`${value}-01`)
    : undefined;
}

export function formatMonth(value: unknown): string {
  const date = monthDate(value);
  return date
    ? new Intl.DateTimeFormat("en-GB-u-ca-gregory-nu-latn", {
        timeZone,
        month: "2-digit",
        year: "numeric",
      }).format(date)
    : missing;
}

export function formatMonthName(value: unknown): string {
  const date = monthDate(value);
  if (!date) return missing;
  const month = new Intl.DateTimeFormat("ar-SA-u-ca-gregory-nu-latn", {
    timeZone,
    month: "long",
  }).format(date);
  return `${month} ${date.getUTCFullYear()}`;
}

export const displayDate = (value: unknown): string =>
  isolateNumber(formatDate(value));
export const displayMonth = (value: unknown): string =>
  isolateNumber(formatMonth(value));
export function displayDateTime(value: unknown): string {
  const d = dateValue(value);if(!d)return missing;
  return isolateNumber(formatDate(value)+" "+new Intl.DateTimeFormat("en-GB-u-nu-latn",{timeZone,hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).format(d));
}
export function displayIdentifier(value: unknown): string {
  const text=String(value??"").replace(/[٠-٩]/g,c=>String("٠١٢٣٤٥٦٧٨٩".indexOf(c))).replace(/[۰-۹]/g,c=>String("۰۱۲۳۴۵۶۷۸۹".indexOf(c)));
  return text?isolateNumber(text):missing;
}
export function displayMonthName(value: unknown): string {
  const text = formatMonthName(value);
  return text.replace(/\d{4}$/, (year) => isolateNumber(year));
}
