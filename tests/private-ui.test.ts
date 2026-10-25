import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { HorseFinancialPanel } from "../src/finance-ui";
import { HorseAccount } from "../src/account-ui";
import { emptyState } from "../functions/src/domain";
test("private horse shows its cost and never shows owner balance or collection controls", () => {
  const s = emptyState();
  const horse = {
    id: "private",
    name: "خيل خاص",
    status: "private",
    boardingFee: 0,
    entryDate: "2026-10-01",
    feeding: [],
  };
  s.horses = [horse];
  s.expenses = [
    {
      id: "salary",
      name: "راتب العامل",
      cost: 1800,
      frequency: "monthly",
      allocationScope: "all_active",
    },
  ];
  const html = renderToStaticMarkup(
    createElement(HorseFinancialPanel, {
      state: s,
      horse,
      month: "2026-10",
      staff: true,
    }),
  );
  assert.match(html, /1,800\.00/);
  assert.match(html, /تكلفته المقدّرة/);
  assert.doesNotMatch(
    html,
    /متبقي|المتبقي|التحصيل خلال الشهر|إيواء شهري متوقع/,
  );
  const account = renderToStaticMarkup(
    createElement(HorseAccount, {
      state: s,
      horse,
      canPay: true,
      onPay: async () => {},
    }),
  );
  assert.doesNotMatch(account, /المتبقي|تسجيل دفعة/);
});
test("boarding horse retains expected income and owner balance in its financial panel", () => {
  const s = emptyState(),
    horse = {
      id: "board",
      name: "خيل",
      status: "boarding",
      boardingFee: 700,
      entryDate: "2026-10-01",
      dueDate: "2026-10-01",
    };
  s.horses = [horse];
  const html = renderToStaticMarkup(
    createElement(HorseFinancialPanel, {
      state: s,
      horse,
      month: "2026-10",
      staff: true,
    }),
  );
  assert.match(html, /متبقي حتى نهاية الشهر/);
  assert.match(html, /رسوم الإيواء/);
});
