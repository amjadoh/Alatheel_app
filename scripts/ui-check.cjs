// Exercises the real app UI against the isolated in-memory test service.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { launchBrowser, startVite } = require("./ui-harness.cjs");
const output = path.resolve(process.env.QA_OUTPUT || "qa-results");
fs.mkdirSync(output, { recursive: true });
const base = process.env.QA_BASE_URL || `http://127.0.0.1:${process.env.QA_PORT || 5174}`;
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
  server = await startVite(base, "/tests/ui/app.html", { attempts: 100, error: "QA app server did not start" });
  browser = await launchBrowser();
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
      name: `ما الجديد في الأثيل ${require("../package.json").version}؟`,
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
        assert.ok(layout.left >= 0 && layout.right <= width + 1);
        assert.ok(
          layout.closeTop >= 0 &&
            layout.closeBottom <= 844 &&
            layout.closeSize >= 44,
        );
        assert.deepEqual(layout.headings, [
          "👤 الحساب والبلاغات", "📊 الرئيسية", "🐎 الخيل", "📦 المخزون", "💳 التحصيل", "🧾 المصروفات",
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
          const menuLayout=await page.locator(".account-popover").evaluate(el=>({width:el.clientWidth,scroll:el.scrollWidth,rows:[...el.querySelectorAll(":scope > button")].map(b=>{const r=b.getBoundingClientRect();return {top:r.top,bottom:r.bottom,height:r.height};})}));
          assert.ok(menuLayout.scroll<=menuLayout.width+1);
          menuLayout.rows.forEach((r,i,rows)=>{assert.ok(r.height>=44);if(i)assert.ok(r.top>=rows[i-1].bottom-1);});
          await page
            .getByRole("button", { name: "إغلاق القائمة", exact: true })
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
            .getByRole("button", { name: "إضافة مصروف", exact: true })
            .click();
          const privateExpense = page.getByRole("dialog", {
            name: "مصروف خاص · خيل ملك خاص تجريبي",
            exact: true,
          });
          await privateExpense.waitFor();
          assert.deepEqual(
            await privateExpense
              .getByLabel(/من يتحمله/)
              .locator("option")
              .allTextContents(),
            ["الإسطبل"],
          );
          await privateExpense
            .getByRole("button", { name: "إغلاق", exact: true })
            .click();
        },
      );
      await check(
        "Purchase UI changes quantity and creates exactly one expense and payment",
        async () => {
          await nav
            .getByRole("button", { name: "المصروفات", exact: true })
            .click();
          await page.getByRole("tab",{name:"مشتريات المخزون",exact:true}).click();
          assert.equal(await page.getByRole("button",{name:"إضافة مصروف",exact:true}).count(),0);
          await page
            .getByRole("button", { name: /^شراء / }).first()
            .click();
          const form = page.getByRole("dialog", {
            name: "شراء مخزون · مركزات",
          });
          await form.getByLabel(/تاريخ الشراء والسداد/).fill("2026-10-27");
          assert.equal(await form.getByLabel(/يخص فترة/).inputValue(),"2026-10");
          await form.getByLabel(/تاريخ الشراء والسداد/).fill("2026-10-28");
          assert.equal(await form.getByLabel(/يخص فترة/).inputValue(),"2026-11");
          await form.getByLabel(/يخص فترة/).fill("2026-12");
          await form.getByLabel(/تاريخ الشراء والسداد/).fill("2026-10-16");
          assert.equal(await form.getByLabel(/يخص فترة/).inputValue(),"2026-12");
          await form.getByLabel(/يخص فترة/).fill("2026-10");
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
          const purchasesPanel=page.getByRole("tabpanel",{name:"مشتريات المخزون",exact:true});
          assert.equal(await purchasesPanel.getByText("مسدد بالكامل",{exact:true}).count(),1);
          assert.doesNotMatch(await purchasesPanel.textContent(),/متبقي|تسجيل سداد مصروف/);
        },
      );
      await check(
        "Expense UI records vendor payment without receiving owner money",
        async () => {
          await nav
            .getByRole("button", { name: "المصروفات", exact: true })
            .click();
          await page.getByRole("tab",{name:"المصروفات الأخرى",exact:true}).click();
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
      await check("Monthly feeding validates its two appointments and saves the exact schedule",async()=>{
        await nav.getByRole("button",{name:"الخيل",exact:true}).click();
        await page.locator(".horse-card").filter({hasText:"خيل ملك خاص تجريبي"}).click();
        await page.getByRole("dialog").getByRole("button",{name:"تعديل",exact:true}).click();
        const form=page.getByRole("dialog",{name:"تعديل بيانات الخيل",exact:true});
        await form.getByLabel("تكرار التغذية 1",{exact:true}).selectOption("monthly");
        const times=form.getByLabel("عدد مرات التغذية 1",{exact:true});
        await times.fill("");assert.equal(await times.isVisible(),true);
        await times.pressSequentially("12");assert.equal(await times.inputValue(),"12");
        assert.equal(await form.getByLabel("تكرار التغذية 1",{exact:true}).inputValue(),"monthly");
        assert.equal(await form.locator(".feeding-slot").count(),12);
        await times.fill("7");assert.equal(await form.locator(".feeding-slot").count(),7);
        await times.fill("2");
        await form.getByLabel("كمية التغذية 1",{exact:true}).fill("0.5");
        await form.getByLabel("يوم التغذية 1 موعد 1",{exact:true}).selectOption("6");
        await form.getByLabel("ترتيب التغذية 1 موعد 1",{exact:true}).selectOption("1");
        await form.getByLabel("يوم التغذية 1 موعد 2",{exact:true}).selectOption("6");
        await form.getByLabel("ترتيب التغذية 1 موعد 2",{exact:true}).selectOption("1");
        await form.getByRole("button",{name:"حفظ ومتابعة",exact:true}).click();
        assert.match(await form.textContent(),/موعد تغذية مكرر/);
        await form.getByLabel("ترتيب التغذية 1 موعد 2",{exact:true}).selectOption("3");
        await page.screenshot({path:path.join(output,"feeding-schedule.png")});
        await form.getByRole("button",{name:"حفظ ومتابعة",exact:true}).click();
        await form.waitFor({state:"detached"});
        const s=await snapshot(page),plan=s.horses.find(h=>h.id==="private").feeding[0];
        assert.equal(plan.timesPerMonth,2);assert.deepEqual(plan.schedule,[{weekday:6,ordinal:1},{weekday:6,ordinal:3}]);
      });
      await check("Inventory activation and actual reconciliation change quantities without duplicating cash",async()=>{
        await nav.getByRole("button",{name:"المخزون",exact:true}).click();
        const before=await snapshot(page);
        await page.getByRole("button",{name:"تأكيد الرصيد وتفعيل الخصم",exact:true}).click();
        let form=page.getByRole("dialog");
        await form.getByLabel(/الموجود فعليًا/).fill("10");await form.getByLabel(/سبب المطابقة/).fill("جرد تجريبي");
        await form.getByRole("button",{name:"حفظ ومتابعة",exact:true}).click();await form.waitFor({state:"detached"});
        let s=await snapshot(page);assert.equal(s.mealTypes[0].autoFeedingFrom,"2026-10-17");assert.equal(s.mealTypes[0].currentStock,10);
        await page.getByRole("button",{name:"مطابقة الكمية الفعلية",exact:true}).click();form=page.getByRole("dialog");
        await form.getByLabel(/الموجود فعليًا/).fill("8.5");await form.getByLabel(/سبب المطابقة/).fill("الكمية الفعلية");
        await form.getByRole("button",{name:"حفظ ومتابعة",exact:true}).click();await form.waitFor({state:"detached"});
        s=await snapshot(page);assert.equal(s.mealTypes[0].currentStock,8.5);assert.deepEqual(s.expensePayments,before.expensePayments);assert.deepEqual(s.expenses,before.expenses);assert.deepEqual(s.income,before.income);
        await page.screenshot({path:path.join(output,"stock-reconciled.png")});
      });
      await check("Notifications expose four staff options including app updates and the approved collection time",async()=>{
        await page.getByRole("button",{name:"التنبيهات",exact:true}).click();
        const panel=page.locator(".notification-page");await panel.waitFor();
        assert.equal(await panel.getByRole("checkbox").count(),4);
        assert.match(await panel.textContent(),/9.*مساءً بتوقيت السعودية/);
        assert.doesNotMatch(await panel.textContent(),/تصل الإشعارات للجوال|الانقطاع المؤقت/);
        await panel.getByLabel("انخفاض المخزون",{exact:true}).uncheck();
        assert.equal(await panel.getByLabel("انخفاض المخزون",{exact:true}).isChecked(),false);
        await page.screenshot({path:path.join(output,"notifications.png")});
      });
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
      const salary = page.locator("section.card").filter({
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
      await form.getByLabel(/تاريخ سداد المصروف/).fill("2026-10-16");
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
  await check(
    "Retrying after a saved receipt loses its network acknowledgement cannot collect the same amount twice",
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
      await page.goto(base + "/tests/ui/app.html?scenario=ambiguous-receipt");
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "إغلاق", exact: true })
        .click();
      await page
        .getByRole("navigation", { name: "التنقل الرئيسي" })
        .getByRole("button", { name: "التحصيل", exact: true })
        .click();
      await page
        .getByRole("button", { name: "كشف الحساب وتسجيل دفعة", exact: true })
        .click();
      const account = page.getByRole("dialog", {
        name: "كشف حساب الخيل",
        exact: true,
      });
      await account
        .getByRole("button", { name: "تسجيل دفعة", exact: true })
        .click();
      await account
        .getByLabel("المبلغ المستلم (ريال)", { exact: true })
        .fill("200");
      await account
        .getByRole("button", { name: "تأكيد استلام المبلغ", exact: true })
        .click();
      await account
        .getByRole("alert")
        .filter({ hasText: "انقطع تأكيد الشبكة" })
        .waitFor();
      assert.equal((await snapshot(page)).income.length, 1);
      await account
        .getByRole("button", { name: "تأكيد استلام المبلغ", exact: true })
        .click();
      await account
        .getByRole("button", { name: "تسجيل دفعة", exact: true })
        .waitFor();
      const state = await snapshot(page);
      assert.equal(state.income.length, 1);
      assert.equal(state.income[0].amount, 200);
      await context.close();
    },
  );
  await check("Owner sees app update preference without staff collection or inventory preferences",async()=>{
    const context=await browser.newContext({viewport:{width:320,height:844},isMobile:true,hasTouch:true});
    await context.route("**/*",route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
    const page=await context.newPage();page.on("pageerror",e=>report.errors.push(e.message));
    await page.goto(base+"/tests/ui/app.html?scenario=owner-alerts");
    await page.getByRole("dialog").getByRole("button",{name:"إغلاق",exact:true}).click();
    await page.getByRole("button",{name:"التنبيهات",exact:true}).click();
    const panel=page.locator(".notification-page");await panel.waitFor();
    assert.equal(await panel.getByRole("checkbox").count(),1);
    await panel.getByLabel("إصدار جديد للتطبيق",{exact:true}).waitFor();
    assert.doesNotMatch(await panel.textContent(),/استحقاق التحصيل|انخفاض المخزون|نفاد المخزون/);
    await page.screenshot({path:path.join(output,"owner-update-alerts.png")});await context.close();
  });
  await check("Restoring a saved session never offers Google sign-in",async()=>{
    const context=await browser.newContext({viewport:{width:320,height:844},isMobile:true});const page=await context.newPage();
    await page.goto(base+"/tests/ui/app.html?scenario=restoring-session");
    await page.getByRole("progressbar",{name:"تقدم فتح الأثيل"}).waitFor();
    assert.equal(await page.getByRole("button",{name:"دخول الأعضاء"}).count(),0);
    assert.equal(await page.getByRole("navigation",{name:"التنقل الرئيسي"}).count(),0);
    await page.screenshot({path:path.join(output,"restoring-session.png")});await context.close();
  });
  await check("Interrupted session verification recovers without another Google sign-in",async()=>{
    const context=await browser.newContext({viewport:{width:320,height:844},isMobile:true});const page=await context.newPage();
    await page.goto(base+"/tests/ui/app.html?scenario=waiting-session");
    await page.getByRole("button",{name:"إعادة المحاولة",exact:true}).waitFor();
    assert.equal(await page.getByRole("button",{name:"دخول الأعضاء"}).count(),0);
    await page.getByRole("button",{name:"إعادة المحاولة",exact:true}).click();
    await page.getByRole("button",{name:/حساب مدير تجريبي/}).waitFor();
    await context.close();
  });
  for (const width of [320,390,430]) {
    await check(`Inventory planning, fractions, kg conversion, purchase and day-27 rollover at ${width}px`,async()=>{
      const context=await browser.newContext({viewport:{width,height:844},isMobile:true,hasTouch:true});
      await context.route("**/*",r=>new URL(r.request().url()).origin===base?r.continue():r.abort());
      const page=await context.newPage();page.on("pageerror",e=>report.errors.push(e.message));
      await page.clock.install({time:new Date("2026-10-18T04:00:00Z")});
      await page.goto(base+"/tests/ui/app.html?scenario=inventory-plan");
      await page.getByRole("dialog").getByRole("button",{name:"إغلاق",exact:true}).click();
      await page.getByRole("navigation",{name:"التنقل الرئيسي"}).getByRole("button",{name:"المخزون",exact:true}).click();
      const clean=t=>t.replace(/[\u2066-\u2069]/g,"");
      const dashboard=page.getByRole("region",{name:"ملخص احتياج المخزون"});
      await dashboard.waitFor();
      assert.match(clean(await dashboard.textContent()),/234\.00/);
      const card=name=>page.locator("section.card").filter({has:page.getByRole("heading",{name,exact:true})});
      const rhodes=card("الرودس"), extra=card("صنف إضافي");
      assert.match(clean(await rhodes.locator(".inventory-shortage").textContent()),/6 ربطة/);
      assert.match(clean(await card("المركزات").locator(".inventory-quantities").textContent()),/190 كجم/);
      assert.match(clean(await extra.locator(".inventory-quantities").textContent()),/8 كجم/);
      await page.screenshot({path:path.join(output,`inventory-dashboard-${width}.png`)});
      await rhodes.locator("summary").click();
      assert.equal(await rhodes.locator(".inventory-horse").count(),8);
      assert.match(clean(await rhodes.locator(".inventory-horse").first().textContent()),/2 ربطة/);
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      const noOverflow=await rhodes.evaluate(e=>e.scrollWidth<=e.clientWidth+1);assert.ok(noOverflow);
      await page.screenshot({path:path.join(output,`inventory-${width}.png`),fullPage:true});
      await page.getByRole("navigation",{name:"التنقل الرئيسي"}).getByRole("button",{name:"المصروفات",exact:true}).click();await page.getByRole("tab",{name:"مشتريات المخزون",exact:true}).click();await page.getByRole("button",{name:"شراء الرودس",exact:true}).click();
      const form=page.getByRole("dialog");await form.getByLabel(/الكمية المشتراة/).fill("6");await form.getByLabel(/إجمالي المبلغ المدفوع/).fill("180");
      await form.getByRole("button",{name:"حفظ ومتابعة",exact:true}).click();await form.waitFor({state:"detached"});
      const s=await snapshot(page);assert.equal(s.mealTypes[0].currentStock,16);assert.equal(s.expensePayments.length,1);assert.equal(s.expensePayments[0].amount,180);
      await page.getByRole("navigation",{name:"التنقل الرئيسي"}).getByRole("button",{name:"المخزون",exact:true}).click();assert.equal(await rhodes.locator(".inventory-shortage").count(),0);
      await page.clock.setSystemTime(new Date("2026-10-27T04:00:00Z"));await page.clock.runFor(31000);
      assert.match(clean(await dashboard.textContent()),/27\/10\/2026 — 27\/10\/2026/);
      await page.clock.setSystemTime(new Date("2026-10-28T04:00:00Z"));await page.clock.runFor(31000);
      assert.match(clean(await dashboard.textContent()),/28\/10\/2026 — 27\/11\/2026/);
      await context.close();
    });
  }
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
