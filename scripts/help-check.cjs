const assert = require("node:assert/strict");
const { launchBrowser, startVite } = require("./ui-harness.cjs");
const base = "http://127.0.0.1:5398";
(async () => {
  const server = await startVite(base, "/tests/ui/app.html", { attempts: 80, force: true });
  let browser;
  try {
    browser = await launchBrowser();
    for (const width of [320, 390, 430]) {
      const page = await browser.newPage({ viewport: { width, height: 844 } });
      await page.route("**/*", (r) =>
        new URL(r.request().url()).origin === base
          ? r.continue()
          : r.abort(),
      );
      await page.addInitScript(
        (v) => localStorage.setItem("alatheel.release.read." + v, "yes"),
        require("../package.json").version,
      );
      await page.goto(
        base + "/tests/ui/app.html?scenario=feedback",
      );
      await page.getByRole("button", { name: /حساب .*افتح المزيد/ }).click();
      await page
        .getByRole("button", { name: "التعليمات", exact: true })
        .click();
      const modal = page.getByRole("dialog", {
        name: "التعليمات",
        exact: true,
      });
      await modal
        .getByRole("navigation", { name: "أقسام التعليمات" })
        .waitFor();
      await page.screenshot({ path: `qa-results/help-sections-${width}.png` });
      await modal.getByRole("button", { name: /الخيل الإضافة/ }).click();
      await modal
        .getByText("البيانات التي تحتاج تعبئتها", { exact: true })
        .waitFor();
      assert.ok(await modal.getByText("اسم الخيل", { exact: true }).count());
      await page.screenshot({ path: `qa-results/help-horses-${width}.png` });
      await modal.getByRole("button", { name: "جميع التعليمات" }).click();
      await modal.getByRole("button", { name: /المخزون الشراء/ }).click();
      await modal
        .getByText("اشتريت علفًا؛ أين أكتب كم دفعت؟", { exact: true })
        .click();
      assert.ok(await modal.getByText(/لا تسجل هذا الشراء مرة ثانية/).count());
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      );
      await page.close();
      console.log(
        "PASS guide navigation, fields, inventory and width " + width,
      );
    }
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
