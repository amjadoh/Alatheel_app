import type { Collection, Row } from "./domain";
export const storageCollection = (name: Collection) =>
  name === "income" ? "incomes" : name;
function normalizeValue(value: any): any {
  if (value && typeof value.toDate === "function")
    return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(normalizeValue);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, normalizeValue(v)]),
    );
  return value;
}
export function normalizeRecord(
  name: Collection,
  id: string,
  data: Record<string, any>,
): Row {
  const row = { ...normalizeValue(data), id };
  for (const field of ["entryDate", "dueDate", "checkoutDate"]) {
    if (typeof row[field] === "string") row[field] = row[field].slice(0, 10);
  }
  if (name === "activities" && !row.action)
    row.action = row.type || "operation";
  return row;
}
