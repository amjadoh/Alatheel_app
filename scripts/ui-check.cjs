// Exercises the real app UI against the isolated in-memory test service.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const { spawn } = require("node:child_process");
const requireQA = process.env.QA_NODE_MODULES
  ? createRequire(path.join(process.env.QA_NODE_MODULES, "_qa.cjs"))
  : require;
const { chromium } = requireQA("playwright");
const output = path.resolve(process.env.QA_OUTPUT || "qa-results");
fs.mkdirSync(output, { recursive: true });
const base = process.env.QA_BASE_URL || "http://127.0.0.1:5174";
const report = { checks: [], errors: [] };
let server, browser;
async function check(name, fn) {
  await fn();
  report.checks.push(name);
  console.log("PASS", name);
}
async function snapshot(page) {
  return page.evaluate(() => window.__alatheelQA());
}
async function main() {
  if (!process.env.QA_BASE_URL) {
    server = spawn(
      process.execPath,
      ["node_modules/vite/bin/vite.js", "--config", "vite.qa.config.ts"],
      { stdio: "ignore" },
    );
    let ready = false;
    for (let i = 0; i < 100; i++) {
      try {
        if ((await fetch(base + "/tests/ui/app.html")).ok) {
          ready = true;
          break;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 200));
    }
    assert.ok(ready, "QA app server did not start");
  }
  browser = await chromium.launch({
    headless: true,
    ...(process.env.QA_CHROME ? { executablePath: process.env.QA_CHROME } : {}),
  });
  for (const width of [320, 390, 430]) {
    const context = await browser.newContext({
      viewport: { width, height: 844 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 1,
    });
    // No external requests, production writes, or invitations are allowed in this fixture.
    await context.route("**/*", (route) =>
      new URL(route.request().url()).origin === base
        ? route.continue()
        : route.abort(),
    );
    const page = await context.newPage();
    page.on("pageerror", (e) => report.errors.push(e.message));
    await page.clock.install({ time: new Date("2026-10-16T12:00:00Z") });
    await page.goto(base + "/tests/ui/app.html");
    const notes = page.getByRole("dialog", {
      name: "ما الجديد في الأثيل 1.7.0؟",
      exact: true,
    });
    await notes.waitFor();
    await check(
      `RTL release notes fit ${width}px with a fixed reachable close button`,
      async () => {
        const layout = await notes.evaluate((d) => {
          const body = d.querySelector(".modal-body"),
            text = d.querySelector(".release-notes"),
            close = d.querySelector('[aria-label="إغلاق"]');
          const box = d.getBoundingClientRect(),
            button = close.getBoundingClientRect();
          return {
            direction: getComputedStyle(text).direction,
            align: getComputedStyle(text).textAlign,
            font: parseFloat(getComputedStyle(text).fontSize),
            scrollWidth: body.scrollWidth,
            clientWidth: body.clientWidth,
            scrollHeight: body.scrollHeight,
            clientHeight: body.clientHeight,
            left: box.left,
            right: box.right,
            closeTop: button.top,
            closeBottom: button.bottom,
            closeSize: button.width,
            headings: [...text.querySelectorAll("h3")].map(
              (x) => x.textContent,
            ),
          };
        });
        assert.equal(layout.direction, "rtl");
        assert.equal(layout.align, "right");
        assert.ok(layout.font >= 14);
        assert.ok(
          layout.scrollWidth <= layout.clientWidth + 1,
          JSON.stringify(layout),
        );
        assert.ok(layout.scrollHeight > layout.clientHeight);
        assert.ok(layout.left >= 0 && layout.right <= width + 1);
        assert.ok(
          layout.closeTop >= 0 &&
            layout.closeBottom <= 844 &&
            layout.closeSize >= 44,
        );
        assert.deepEqual(layout.headings, [
          "حسابك · أعلى اليسار",
          "الصفحة الرئيسية",
          "الخيل",
          "المخزون",
          "التحصيل",
          "المصروفات",
        ]);
        await page.screenshot({
          path: path.join(output, `release-${width}-top.png`),
        });
        await notes
          .locator(".modal-body")
          .evaluate((e) => (e.scrollTop = e.scrollHeight));
        await page.screenshot({
          path: path.join(output, `release-${width}-bottom.png`),
        });
      },
    );
    await notes.getByRole("button", { name: "إغلاق", exact: true }).click();
    await page.reload();
    await page.getByRole("navigation", { name: "التنقل الرئيسي" }).waitFor();
    await check(
      `Release dismissal persists and five navigation entries fit ${width}px`,
      async () => {
        assert.equal(await page.getByRole("dialog").count(), 0);
        assert.deepEqual(
          await page
            .getByRole("navigation", { name: "التنقل الرئيسي" })
            .getByRole("button")
            .allTextContents(),
          ["الرئيسية", "الخيل", "المخزون", "التحصيل", "المصروفات"],
        );
        assert.ok(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        );
      },
    );
    if (width === 390) {
      const nav = page.getByRole("navigation", { name: "التنقل الرئيسي" });
      await check(
        "Account name opens More and private horse hides collection balances",
        async () => {
          await page
            .getByRole("button", {
              name: "حساب مدير تجريبي، افتح المزيد",
              exact: true,
            })
            .click();
          await page
            .getByRole("navigation", { name: "المزيد وخيارات الحساب" })
            .waitFor();
          await page.screenshot({
            path: path.join(output, "account-menu.png"),
          });
          await page
            .getByRole("button", { name: "إغلاق قائمة الحساب", exact: true })
            .click();
          await nav.getByRole("button", { name: "الخيل", exact: true }).click();
          await page
            .locator(".horse-card")
            .filter({ hasText: "خيل ملك خاص تجريبي" })
            .click();
          const detail = page.getByRole("dialog");
          await detail.waitFor();
          assert.doesNotMatch(
            await detail.textContent(),
            /متبقي على المالك|المتبقي على المالك|تسجيل دفعة|كشف الحساب وتسجيل/,
          );
          await page.screenshot({
            path: path.join(output, "private-horse.png"),
          });
          await detail
            .getByRole("button", { name: "إغلاق", exact: true })
            .click();
        },
      );
      await check(
        "Purchase UI changes quantity and creates exactly one expense and payment",
        async () => {
          await nav
            .getByRole("button", { name: "المخزون", exact: true })
            .click();
          await page
            .getByRole("button", { name: "شراء وإضافة", exact: true })
            .click();
          const form = page.getByRole("dialog", {
            name: "شراء وإضافة · مركزات",
          });
          await form.getByLabel(/الكمية المشتراة/).fill("20");
          await form.getByLabel(/إجمالي المبلغ المدفوع/).fill("1800");
          await form.getByLabel(/تاريخ الشراء والسداد/).fill("2026-10-16");
          await form
            .getByRole("button", { name: "حفظ ومتابعة", exact: true })
            .click();
          await form.waitFor({ state: "detached" });
          const s = await snapshot(page);
          assert.equal(s.mealTypes[0].currentStock, 25);
          assert.equal(s.inventoryTransactions.length, 1);
          assert.equal(
            s.expenses.filter((e) => e.expenseKind === "feed_purchase").length,
            1,
          );
          assert.equal(s.expensePayments.length, 1);
          assert.equal(s.expensePayments[0].amount, 1800);
        },
      );
      await check(
        "Expense UI records vendor payment without receiving owner money",
        async () => {
          await nav
            .getByRole("button", { name: "المصروفات", exact: true })
            .click();
          const vet = page.locator("section.card").filter({
            has: page.getByRole("heading", {
              name: "زيارة طبيب",
              exact: true,
            }),
          });
          await vet
            .getByRole("button", { name: "تسجيل سداد مصروف", exact: true })
            .click();
          const form = page.getByRole("dialog", {
            name: "سداد زيارة طبيب",
            exact: true,
          });
          await form.getByLabel(/المبلغ المدفوع/).fill("100");
          await form.getByLabel(/تاريخ سداد المصروف/).fill("2026-10-16");
          await form
            .getByRole("button", { name: "حفظ ومتابعة", exact: true })
            .click();
          await form.waitFor({ state: "detached" });
          const s = await snapshot(page);
          assert.equal(
            s.expensePayments.filter((p) => p.expenseId === "vet")[0].amount,
            100,
          );
          assert.equal(s.income.length, 0);
        },
      );
      await check(
        "Monthly then partial collection settles old debt and retains advance credit",
        async () => {
          await nav
            .getByRole("button", { name: "التحصيل", exact: true })
            .click();
          await page
            .getByRole("button", {
              name: "كشف الحساب وتسجيل دفعة",
              exact: true,
            })
            .click();
          const account = page.getByRole("dialog", {
            name: "كشف حساب الخيل",
            exact: true,
          });
          await account
            .getByRole("button", { name: "تسجيل دفعة", exact: true })
            .click();
          await account
            .getByRole("button", { name: "دفع استحقاق الشهر", exact: true })
            .click();
          assert.equal(
            await account
              .getByLabel("المبلغ المستلم (ريال)", { exact: true })
              .inputValue(),
            "700",
          );
          await account
            .getByRole("button", { name: "تأكيد استلام المبلغ", exact: true })
            .click();
          await account
            .getByRole("button", { name: "تسجيل دفعة", exact: true })
            .waitFor();
          let s = await snapshot(page);
          assert.equal(s.income.length, 1);
          assert.equal(s.income[0].amount, 700);
          assert.equal(s.income[0].allocations[0].dueDate, "2026-10-20");
          await account
            .getByRole("button", { name: "تسجيل دفعة", exact: true })
            .click();
          await account
            .getByRole("button", { name: "دفع جزئي", exact: true })
            .click();
          await account
            .getByLabel("المبلغ المستلم (ريال)", { exact: true })
            .fill("900");
          await account
            .getByRole("button", { name: "تأكيد استلام المبلغ", exact: true })
            .click();
          await account
            .getByRole("button", { name: "تسجيل دفعة", exact: true })
            .waitFor();
          s = await snapshot(page);
          assert.equal(s.income.length, 2);
          assert.equal(s.income[1].advanceAmount, 200);
          assert.equal(s.income[1].allocations[0].dueDate, "2026-09-20");
          assert.equal(s.expensePayments.length, 2);
          await page.screenshot({
            path: path.join(output, "collection-statement.png"),
          });
          await account
            .getByRole("button", { name: "إغلاق", exact: true })
            .click();
          await nav
            .getByRole("button", { name: "الرئيسية", exact: true })
            .click();
          await page.screenshot({
            path: path.join(output, "cash-dashboard.png"),
          });
        },
      );
    }
    await context.close();
  }
  await check(
    "Closed expense UI shows original definitions and records a later settlement without changing its closed month",
    async () => {
      const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      });
      await context.route("**/*", (route) =>
        new URL(route.request().url()).origin === base
          ? route.continue()
          : route.abort(),
      );
      const page = await context.newPage();
      page.on("pageerror", (e) => report.errors.push(e.message));
      await page.clock.install({ time: new Date("2026-10-16T12:00:00Z") });
      await page.goto(base + "/tests/ui/app.html?scenario=closed-expenses");
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "إغلاق", exact: true })
        .click();
      await page
        .getByRole("navigation", { name: "التنقل الرئيسي" })
        .getByRole("button", { name: "المصروفات", exact: true })
        .click();
      await page.getByLabel("شهر المصروف", { exact: true }).fill("2026-09");
      const salary = page
        .locator("section.card")
        .filter({
          has: page.getByRole("heading", { name: "راتب العامل", exact: true }),
        });
      await salary.waitFor();
      assert.equal(
        await page
          .getByRole("heading", { name: "تشغيل جديد", exact: true })
          .count(),
        0,
      );
      assert.equal(
        await page
          .getByRole("button", { name: "إضافة مصروف", exact: true })
          .isDisabled(),
        true,
      );
      assert.equal(
        await salary
          .getByRole("button", { name: "تعديل", exact: true })
          .count(),
        0,
      );
      const before = (await snapshot(page)).financialPeriods.find(
        (p) => p.id === "2026-09",
      );
      await salary
        .getByRole("button", { name: "تسجيل سداد مصروف", exact: true })
        .click();
      const form = page.getByRole("dialog", {
        name: "سداد راتب العامل",
        exact: true,
      });
      assert.equal(
        await form.getByLabel(/المبلغ المدفوع/).inputValue(),
        "1800",
      );
      await form.getByLabel(/المبلغ المدفوع/).fill("600");
      await form
        .getByLabel(/تاريخ سداد المصروف/)
        .fill("2026-10-16");
      await form
        .getByRole("button", { name: "حفظ ومتابعة", exact: true })
        .click();
      await form.waitFor({ state: "detached" });
      const after = await snapshot(page);
      assert.deepEqual(
        after.financialPeriods.find((p) => p.id === "2026-09"),
        before,
      );
      assert.equal(after.expensePayments[0].cashCategory, "salary");
      assert.equal(after.expensePayments[0].period, "2026-09");
      assert.equal(after.expensePayments[0].amount, 600);
      assert.equal(after.expenses[0].name, "تشغيل جديد");
      await page.screenshot({
        path: path.join(output, "closed-expense-settlement.png"),
      });
      await context.close();
    },
  );
  assert.deepEqual(report.errors, []);
}
main()
  .catch((e) => {
    report.failure = e.stack;
    console.error(e.stack);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (browser) await browser.close();
    if (server) server.kill();
    fs.writeFileSync(
      path.join(output, "report.json"),
      JSON.stringify(report, null, 2),
    );
  });
