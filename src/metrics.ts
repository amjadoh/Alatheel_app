import { State, Row, money } from "./service";
export function costs(s: State, month: string) {
  const [year, m] = month.split("-").map(Number),
    days = new Date(year, m, 0).getDate();
  const active = s.horses.filter((h) => h.status !== "archived");
  const feeding = active.reduce(
    (n, h) =>
      n +
      (h.feeding || []).reduce(
        (a: number, f: any) =>
          a +
          Number(f.quantity) *
            (s.mealTypes.find((t) => t.id === f.mealTypeId)?.pricePerUnit ||
              0) *
            days,
        0,
      ),
    0,
  );
  const other = s.expenses.reduce(
    (n, e) =>
      n +
      (e.frequency === "once"
        ? String(e.createdAt).slice(0, 7) === month
          ? e.cost
          : 0
        : e.cost *
          (e.frequency === "daily"
            ? days
            : e.frequency === "weekly"
              ? days / 7
              : 1)),
    0,
  );
  const collected = s.income
    .filter((i) => String(i.collectedAt).slice(0, 7) === month)
    .reduce((n, i) => n + i.amount, 0);
  const expected = active
    .filter((h) => ["boarding", "boarding_breeding"].includes(h.status))
    .reduce((n, h) => n + Number(h.boardingFee || 0), 0);
  return {
    feeding: money(feeding),
    other: money(other),
    total: money(feeding + other),
    collected: money(collected),
    expected: money(expected),
    balance: money(collected - feeding - other),
  };
}
export function horseCost(s: State, h: Row, month: string) {
  const [y, m] = month.split("-").map(Number),
    days = new Date(y, m, 0).getDate();
  const food = (h.feeding || []).reduce(
    (a: number, f: any) =>
      a +
      Number(f.quantity) *
        (s.mealTypes.find((t) => t.id === f.mealTypeId)?.pricePerUnit || 0) *
        days,
    0,
  );
  const other = s.expenses
    .filter((e) => e.horseIds?.includes(h.id))
    .reduce(
      (n, e) =>
        n +
        (e.frequency === "once"
          ? String(e.createdAt).slice(0, 7) === month
            ? e.allocations?.[h.id] || 0
            : 0
          : (e.cost / e.horseIds.length) *
            (e.frequency === "daily"
              ? days
              : e.frequency === "weekly"
                ? days / 7
                : 1)),
      0,
    );
  return { food: money(food), other: money(other), total: money(food + other) };
}
