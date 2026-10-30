const assert = require("node:assert/strict"),
  { launchBrowser, startVite } = require("./ui-harness.cjs");
const base = process.env.QA_BASE_URL || "http://127.0.0.1:5199";
(async () => {
  const server = await startVite(base, "/tests/ui/feedback-status.html");
  let browser;
  try {
    browser = await launchBrowser();
    for (const width of [320, 390, 430]) {
      const p = await browser.newPage({ viewport: { width, height: 844 } });
      await p.route("**/*", (r) =>
        new URL(r.request().url()).origin === base ? r.continue() : r.abort(),
      );
      await p.goto(
        base + "/tests/ui/feedback-status.html?scenario=feedback-status",
        { waitUntil: "networkidle", timeout: 60000 },
      );
      await p
        .getByRole("combobox", { name: "حالة البلاغ", exact: true })
        .selectOption("resolved");
      const save = p.getByRole("button", { name: "حفظ الحل", exact: true });
      assert.equal(await save.isDisabled(), true);
      await p
        .getByLabel("بلاغ الحل", { exact: true })
        .fill("تم إصلاح سبب البلاغ التجريبي");
      await save.click();
      await p.getByText("جارٍ تحديث حالة GitHub", { exact: true }).waitFor();
      await p.evaluate(() => window.__feedbackStatusComplete("synced"));
      await p
        .getByText("حالة البلاغ متزامنة مع GitHub", { exact: true })
        .waitFor();
      await p
        .getByRole("combobox", { name: "حالة البلاغ", exact: true })
        .selectOption("discussion");
      await p.getByText("جارٍ تحديث حالة GitHub", { exact: true }).waitFor();
      await p.evaluate(() => window.__feedbackStatusComplete("failed"));
      await p
        .getByRole("button", { name: "مزامنة حالة GitHub", exact: true })
        .click();
      await p.getByText("جارٍ تحديث حالة GitHub", { exact: true }).waitFor();
      await p.evaluate(() => window.__feedbackStatusComplete("synced"));
      assert.ok(
        await p.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      );
      await p.screenshot({ path: `qa-results/feedback-status-${width}.png` });
      await p.close();
      console.log(
        "PASS primary status resolution, reopen, progress and retry fit " +
          width,
      );
    }
    const p = await browser.newPage();
    await p.goto(
      base +
        "/tests/ui/feedback-status.html?scenario=feedback-status&secondary=1",
      { waitUntil: "networkidle" },
    );
    await p.getByText("بلاغ اختبار حالة GitHub", { exact: true }).waitFor();
    assert.equal(await p.getByRole("combobox", { name: "حالة البلاغ", exact: true }).count(), 0);
    assert.equal(
      await p
        .getByRole("button", { name: "مزامنة حالة GitHub", exact: true })
        .count(),
      0,
    );
    console.log(
      "PASS secondary administrators cannot change or retry GitHub state",
    );
  } finally {
    await browser?.close();
    server?.kill();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
