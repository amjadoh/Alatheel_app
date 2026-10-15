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
