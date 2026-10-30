const assert = require("node:assert/strict"),
  { launchBrowser, startVite } = require("./ui-harness.cjs");
const base = process.env.QA_BASE_URL || "http://127.0.0.1:5198";
(async () => {
  let browser;
  const server = await startVite(base, "/tests/ui/app.html");
  try {
    browser = await launchBrowser();
    for (const width of [320, 390, 430]) {
      const p = await browser.newPage({ viewport: { width, height: 844 } });
      await p.route("**/*", (r) =>
        new URL(r.request().url()).origin === base ? r.continue() : r.abort(),
      );
      await p.addInitScript(
        (v) => localStorage.setItem("alatheel.release.read." + v, "yes"),
        require("../package.json").version,
      );
      await p.goto(base + "/tests/ui/app.html?scenario=fifo", {
        waitUntil: "networkidle",
        timeout: 60000,
      });
      const nav = p.getByRole("navigation", { name: "التنقل الرئيسي" });
      await nav.getByRole("button", { name: "المخزون", exact: true }).click();
      assert.equal(await p.getByRole("button", { name: /^شراء / }).count(), 0);
      await nav.getByRole("button", { name: "المصروفات", exact: true }).click();
      await p
        .getByRole("tab", { name: "مشتريات المخزون", exact: true })
        .click();
      await p
        .getByRole("button", { name: "شراء شعير تجريبي", exact: true })
        .click();
      const form = p.getByRole("dialog");
      await form.getByLabel(/الكمية المشتراة/).fill("10");
      await form.getByLabel(/إجمالي المبلغ المدفوع/).fill("150");
      await form.getByLabel(/تاريخ الشراء والسداد/).fill("2026-10-16");
      await form.getByLabel("المورد", { exact: true }).fill("مورد اختباري");
      await form.getByLabel("رقم الفاتورة", { exact: true }).fill("QA-150");
      await form
        .getByRole("button", { name: "حفظ ومتابعة", exact: true })
        .click();
      await form.waitFor({ state: "detached" });
      let s = await p.evaluate(() => window.__alatheelQA());
      assert.equal(s.mealTypes[0].currentStock, 13);
      assert.equal(
        s.mealTypes[0].feedBatches.reduce((n, b) => n + b.remainingCents, 0),
        18000,
      );
      assert.equal(s.expenses.length, 2);
      assert.equal(
        s.expensePayments.reduce((n, x) => n + x.amount, 0),
        250,
      );
      await p.evaluate(() => window.__fifoQAConsume());
      s = await p.evaluate(() => window.__alatheelQA());
      assert.equal(s.mealTypes[0].currentStock, 8);
      assert.equal(
        s.mealTypes[0].feedBatches.reduce((n, b) => n + b.remainingCents, 0),
        12000,
      );
      const movement = s.inventoryTransactions.find(
        (x) => x.movementKind === "feeding",
      );
      assert.equal(movement.breakdown[0].batchCostCents, 6000);
      assert.equal(s.expenses.length, 2);
      assert.equal(s.expensePayments.length, 2);
      await nav.getByRole("button", { name: "الخيل", exact: true }).click();
      await p
        .locator(".horse-card")
        .filter({ hasText: "خيل اختبار الدفعات" })
        .click();
      await p.getByRole("dialog").waitFor();
      const cost = await p
        .getByRole("dialog")
        .locator("dt")
        .filter({ hasText: "استهلاك التغذية" })
        .locator("xpath=following-sibling::dd[1]")
        .innerText();
      assert.equal(cost.replace(/[\u2066-\u2069]/g, "").trim(), "60.00 ر.س");
      await p.screenshot({ path: `qa-results/feed-batches-${width}.png` });
      assert.ok(
        await p.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      );
      await p.close();
      console.log(
        "PASS expenses-only FIFO purchase, horse cost 60, stock 120, and no duplicate cash " +
          width,
      );
    }
  } finally {
    await browser?.close();
    server?.kill();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
