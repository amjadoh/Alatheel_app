import test from "node:test";
import assert from "node:assert/strict";
import {
  displayAmount,
  displayDate,
  displayMonth,
  displayMonthName,
  displayNumber,
  displayPercent,
  displayPrice,
  displayQuantity,
  formatAmount,
  formatDate,
  formatMonth,
  formatMonthName,
  formatNumber,
  formatPercent,
  formatPrice,
  formatQuantity,
} from "../src/format";

const isolate = (text: string) => `\u2066${text}\u2069`;

test("money uses Western digits, a comma for thousands, a dot and two halala digits", () => {
  assert.equal(formatAmount(-20053.93), "-20,053.93");
  assert.equal(formatAmount(1800), "1,800.00");
  assert.equal(formatAmount(0), "0.00");
  assert.equal(formatAmount(" 2200.5 "), "2,200.50");
  assert.equal(formatAmount(123456789.123), "123,456,789.12");
});

test("rounded zero never displays a loss sign and real halala losses retain it", () => {
  assert.equal(formatAmount(-0), "0.00");
  assert.equal(formatAmount(-0.004), "0.00");
  assert.equal(formatAmount(-0.005), "-0.01");
  assert.equal(formatQuantity(-0.000000001), "0");
});

test("stock and unit prices retain meaningful precision without scientific notation", () => {
  assert.equal(formatQuantity(0.00000001), "0.00000001");
  assert.equal(formatQuantity(0.125), "0.125");
  assert.equal(formatQuantity(1000.5), "1,000.5");
  assert.equal(formatPrice(0.003125), "0.003125");
  assert.equal(formatPrice(500 / 300), "1.66666667");
  assert.equal(formatPrice(5), "5.00");
  assert.equal(formatNumber(7), "7");
  assert.equal(formatPercent(12.345), "12.35%");
});

test("invalid finance values display a missing marker instead of zero, NaN or infinity", () => {
  for (const value of [undefined, null, "", "bad", NaN, Infinity, -Infinity, false]) {
    assert.equal(formatAmount(value), "—");
    assert.equal(formatQuantity(value), "—");
    assert.equal(displayAmount(value), "—");
    assert.equal(formatPercent(value), "—");
  }
});

test("display isolates the entire signed number from Arabic currency and punctuation", () => {
  assert.equal(displayAmount(-20053.93), isolate("-20,053.93"));
  assert.equal(
    `عجز تشغيل مقدّر ${displayAmount(-20053.93)} ر.س`,
    `عجز تشغيل مقدّر ${isolate("-20,053.93")} ر.س`,
  );
  assert.equal(displayNumber(1200), isolate("1,200"));
  assert.equal(displayQuantity(0.125), isolate("0.125"));
  assert.equal(displayPrice(0.003125), isolate("0.003125"));
  assert.equal(displayPercent(50), isolate("50%"));
  assert.doesNotMatch(
    [formatAmount(-20053.93), formatNumber(7), formatQuantity(0.125)].join(" "),
    /[\u0660-\u066c\u06f0-\u06f9\u2066-\u2069]/,
  );
});

test("dates consistently use Gregorian Western digits and the Saudi business date", () => {
  assert.equal(formatDate("2026-10-18"), "18/10/2026");
  assert.equal(formatDate("2026-10-17T21:30:00Z"), "18/10/2026");
  assert.equal(formatDate("2026-10-18T00:30:00+03:00"), "18/10/2026");
  assert.equal(formatDate("2024-02-29"), "29/02/2024");
  assert.equal(formatDate("2026-02-29"), "—");
  assert.equal(formatDate("2026-10-18T00:30:00"), "—");
  assert.equal(formatDate("2026-99-99"), "—");
  assert.equal(displayDate("2026-10-18"), isolate("18/10/2026"));
});

test("months preserve Arabic month names with Western years and isolated numeric labels", () => {
  assert.equal(formatMonth("2026-10"), "10/2026");
  assert.equal(displayMonth("2026-10"), isolate("10/2026"));
  assert.match(formatMonthName("2026-10"), / 2026$/);
  assert.match(displayMonthName("2026-10"), / \u20662026\u2069$/);
  assert.doesNotMatch(formatMonthName("2026-10"), /[\u0660-\u0669]/);
  assert.equal(formatMonth("2026-13"), "—");
  assert.equal(displayMonthName("bad"), "—");
});
