import type { Row } from "./domain";
export const itemKey = (name: unknown) =>
  String(name || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670\u0640]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/\s+/g, " ")
    .trim();
export function similarItems(items: Row[], name: unknown, except?: string) {
  const target = itemKey(name);
  if (target.length < 3) return [];
  const near = (a: string, b: string) => {
    if (a === b) return true;
    if (Math.abs(a.length - b.length) > 1 || Math.min(a.length, b.length) < 4)
      return false;
    let i = 0,
      j = 0,
      errors = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) {
        i++;
        j++;
        continue;
      }
      if (++errors > 1) return false;
      if (a.length >= b.length) i++;
      if (b.length >= a.length) j++;
    }
    return errors + (i < a.length || j < b.length ? 1 : 0) <= 1;
  };
  return items.filter((m) => m.id !== except && near(itemKey(m.name), target));
}
