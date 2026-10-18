type Meal = Record<string, any>;
const westernDigits = (s: string) =>
  s.replace(/[٠-٩۰-۹]/g, (c) =>
    String(
      "٠١٢٣٤٥٦٧٨٩".indexOf(c) >= 0
        ? "٠١٢٣٤٥٦٧٨٩".indexOf(c)
        : "۰۱۲۳۴۵۶۷۸۹".indexOf(c),
    ),
  );

/** Inventory stays in purchase units; feeding quantities use the displayed consumption unit. */
export function feedingMeasure(meal: Meal) {
  const explicit = Number(meal.feedingUnitsPerPurchaseUnit);
  if (meal.feedingUnit && Number.isFinite(explicit) && explicit > 0)
    return { unit: String(meal.feedingUnit), unitsPerPurchaseUnit: explicit };
  // Read unambiguous legacy weights such as "كيس 40 كجم", without guessing bale weights.
  const label = westernDigits(String(meal.unit || ""))
    .toLowerCase()
    .trim();
  const weight = label.match(
    /(\d+(?:[.٫]\d+)?)\s*(?:كجم|كغم|كيلوغرام|كيلوجرام|كيلو|kg)(?:\s|$)/u,
  );
  const amount = Number(weight?.[1]?.replace("٫", "."));
  if (Number.isFinite(amount) && amount > 0)
    return { unit: "كجم", unitsPerPurchaseUnit: amount };
  if (/^(?:كجم|كغم|كيلو|كيلوغرام|كيلوجرام|kg)$/u.test(label))
    return { unit: "كجم", unitsPerPurchaseUnit: 1 };
  return { unit: String(meal.unit || "وحدة"), unitsPerPurchaseUnit: 1 };
}

export function feedingUnitPrice(meal: Meal) {
  return (
    Number(meal.pricePerUnit || 0) / feedingMeasure(meal).unitsPerPurchaseUnit
  );
}

export type FeedingSlot = { weekday: number; ordinal: number };
export const stockPrecision = (n: number) => Math.round((n + Number.EPSILON) * 1e8) / 1e8;
export const addFeedingDays = (day: string, days: number) =>
  new Date(Date.parse(day + "T12:00:00Z") + days * 86400000).toISOString().slice(0, 10);
export const previousFeedingDay = (day: string) => addFeedingDays(day, -1);

/** Fixed ordinal weekdays always exist (1..4); a fifth weekday is deliberately not offered. */
export function validateFeedingSchedule(value: unknown, count: number): FeedingSlot[] | undefined {
  if (value === undefined) return undefined; // Existing count-only plans stay estimates until deliberately scheduled.
  if (!Array.isArray(value) || value.length !== count || value.length > 28)
    throw new Error("حدد موعدًا مختلفًا لكل مرة تغذية بالشهر");
  const slots = value.map((slot: any) => {
    if (slot?.weekday === "" || slot?.weekday == null || slot?.ordinal === "" || slot?.ordinal == null)
      throw new Error("أكمل اليوم وترتيبه لكل موعد تغذية");
    const weekday = Number(slot?.weekday), ordinal = Number(slot?.ordinal);
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6 ||
        !Number.isInteger(ordinal) || ordinal < 1 || ordinal > 4)
      throw new Error("حدد اليوم وترتيبه من الأول إلى الرابع داخل الشهر");
    return { weekday, ordinal };
  });
  if (new Set(slots.map(x => x.weekday + ":" + x.ordinal)).size !== slots.length)
    throw new Error("لا يمكن تكرار موعد التغذية نفسه");
  return slots.sort((a, b) => a.ordinal - b.ordinal || a.weekday - b.weekday);
}

export function scheduledFeedingDates(plan: Meal, month: string): string[] {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("الشهر غير صحيح");
  const [year, number] = month.split("-").map(Number);
  const length = new Date(Date.UTC(year, number, 0)).getUTCDate();
  if ((plan.frequency || "daily") === "daily")
    return Array.from({ length }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);
  if (!Array.isArray(plan.schedule) || !plan.schedule.length) return [];
  const firstWeekday = new Date(month + "-01T12:00:00Z").getUTCDay();
  return plan.schedule.map((slot: FeedingSlot) => {
    const day = 1 + (slot.weekday - firstWeekday + 7) % 7 + (slot.ordinal - 1) * 7;
    return `${month}-${String(day).padStart(2, "0")}`;
  }).sort();
}

export function feedingOnDate(plan: Meal, day: string) {
  return (plan.frequency || "daily") === "daily" || scheduledFeedingDates(plan, day.slice(0, 7)).includes(day);
}

export function horsePresentOn(horse: Meal, day: string) {
  if (horse.status === "archived" && !horse.exitDate && !horse.stayPeriods?.length) return false;
  const periods = horse.stayPeriods?.length ? horse.stayPeriods :
    [{ entryDate: horse.entryDate || "0000-00-00", exitDate: horse.exitDate }];
  return periods.some((p: Meal) => String(p.entryDate || "0000-00-00").slice(0, 10) <= day &&
    (!p.exitDate || String(p.exitDate).slice(0, 10) >= day));
}

export function feedingAtDate(horse: Meal, day: string): Meal[] {
  if (!horse.feedingHistory?.length) return horse.feeding || [];
  const versions = horse.feedingHistory.filter((v: Meal) => v.from <= day)
    .sort((a: Meal, b: Meal) => a.from.localeCompare(b.from) || String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
  return versions.at(-1)?.feeding || [];
}

export function feedingSkipped(horse: Meal, mealTypeId: string, day: string) {
  return !!horse.feedingSkips?.some((skip: Meal) => skip.mealTypeId === mealTypeId && skip.date === day);
}

/** Explicit classification wins. Exact legacy names preserve existing feed-purchase records. */
export function expenseFeedMeal(expense: Meal, meals: Meal[]) {
  if (expense.expenseKind === "operating") return undefined;
  if (expense.expenseKind === "feed_purchase")
    return meals.find((m) => m.id === expense.mealTypeId);
  const name = String(expense.name || "")
    .trim()
    .replace(/\s+/g, " ");
  return meals.find(
    (m) =>
      String(m.name || "")
        .trim()
        .replace(/\s+/g, " ") === name,
  );
}
