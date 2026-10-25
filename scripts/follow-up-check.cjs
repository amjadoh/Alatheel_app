// Real app UI with command-generated, isolated accounting fixtures only.
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
const {spawn}=require("node:child_process"),{createRequire}=require("node:module");
const requireQA=process.env.QA_NODE_MODULES?createRequire(path.join(process.env.QA_NODE_MODULES,"_qa.cjs")):require;
const {chromium}=requireQA("playwright");
const base=process.env.QA_BASE_URL||`http://127.0.0.1:${process.env.QA_FOLLOWUP_PORT||5394}`;
const output=path.resolve(process.env.QA_OUTPUT||"qa-results");
const report={scope:"Isolated command-generated accounts; no production writes",checks:[],errors:[]};
const clean=s=>String(s).replace(/[\u2066-\u2069]/g,"");
const wait=ms=>new Promise(r=>setTimeout(r,ms));
let browser,server;
fs.mkdirSync(output,{recursive:true});
async function check(name,fn){await fn();report.checks.push(name);console.log("PASS",name);}
async function snapshot(page){return page.evaluate(()=>window.__alatheelQA());}
async function fits(page,locator,width){
  const boxes=await locator.evaluate(e=>({direction:getComputedStyle(e).direction,left:e.getBoundingClientRect().left,right:e.getBoundingClientRect().right,sw:e.scrollWidth,cw:e.clientWidth,documentWidth:document.documentElement.scrollWidth,viewport:innerWidth}));
  assert.equal(boxes.direction,"rtl");assert.ok(boxes.left>=0&&boxes.right<=width+1&&boxes.sw<=boxes.cw+1&&boxes.documentWidth<=boxes.viewport+1,JSON.stringify(boxes));
}
(async()=>{
  if(!process.env.QA_BASE_URL){
    server=spawn(process.execPath,["node_modules/vite/bin/vite.js","--config","vite.qa.config.ts","--port",new URL(base).port,"--strictPort"],{stdio:"ignore"});
    let ready=false;
    for(let i=0;i<120;i++){try{if((await fetch(base+"/tests/ui/app.html")).ok){ready=true;break;}}catch{}await wait(200);}
    assert.ok(ready,"Follow-up fixture server did not start");
  }
  browser=await chromium.launch({headless:true,...(process.env.QA_CHROME?{executablePath:process.env.QA_CHROME}:{})});
  for(const width of [320,390,430]){
    const context=await browser.newContext({viewport:{width,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:1});
    await context.route("**/*",route=>new URL(route.request().url()).origin===new URL(base).origin?route.continue():route.abort());
    const page=await context.newPage();page.on("pageerror",e=>report.errors.push(e.message));
    await page.clock.install({time:new Date("2026-10-21T12:00:00Z")});
    const version=require("../package.json").version;
    await page.addInitScript(version=>localStorage.setItem("alatheel.release.read."+version,"yes"),version);
    await page.goto(base+"/tests/ui/app.html?scenario=follow-up");
    const today=page.getByRole("region",{name:"يحتاج إجراء اليوم",exact:true});
    const review=page.getByRole("region",{name:"مراجعة بيانات الحسابات",exact:true});
    const forecast=page.getByRole("region",{name:"توقع التحصيل والمدفوعات",exact:true});
    await page.locator(".daily-follow-up>summary").click();await today.waitFor();
    const baseline=await snapshot(page);
    await check(`Today's follow-up is compact and fits ${width}px RTL`,async()=>{
      for(const panel of [today,review,forecast])await fits(page,panel,width);
      assert.equal(await review.locator("details[open]").count(),0);
      assert.equal(await forecast.locator("details[open]").count(),0);
      assert.match(clean(await today.textContent()),/21\/10\/2026/);
      assert.equal(await today.getByText("متابعة المخزون",{exact:true}).count(),0,"Future stockout must not become an instruction to buy today");
      assert.match(clean(await forecast.locator(".follow-up-collapse>summary").textContent()),/790\.00/);
      await page.locator(".daily-follow-up").screenshot({path:path.join(output,`follow-up-${width}.png`)});
    });
    await check(`Partial, prepaid and private horses are classified correctly at ${width}px`,async()=>{
      const due=today.locator("details").filter({has:page.locator("summary",{hasText:"استحقاقات اليوم"})});
      const overdue=today.locator("details").filter({has:page.locator("summary",{hasText:"تحصيل متأخر"})});
      assert.match(clean(await due.locator("summary").textContent()),/1,100\.00/);
      assert.match(clean(await overdue.locator("summary").textContent()),/750\.00/);
      await due.locator("summary").click();await overdue.locator("summary").click();
      assert.equal(await today.getByRole("button",{name:/خيل استحقاق اليوم/}).count(),1);
      assert.equal(await today.getByRole("button",{name:/خيل دفعة جزئية/}).count(),2,"Boarding arrears and today's reimbursable vet bill are separate groups");
      assert.equal(await today.getByRole("button",{name:/خيل دفع مقدم|خيل ملك خاص/}).count(),0);
      await overdue.getByRole("button",{name:/خيل دفعة جزئية/}).click();
      const account=page.getByRole("dialog",{name:"كشف حساب الخيل",exact:true});await account.waitFor();
      assert.match(clean(await account.textContent()),/خيل دفعة جزئية/);
      await account.getByRole("button",{name:"إغلاق",exact:true}).click();
      await page.getByRole("navigation",{name:"التنقل الرئيسي"}).getByRole("button",{name:"الرئيسية",exact:true}).click();
    });
    await check(`Forecast reconciles real payments once and stays independent from report month at ${width}px`,async()=>{
      if(!await page.locator(".daily-follow-up").getAttribute("open"))await page.locator(".daily-follow-up>summary").click();
      await forecast.locator(".follow-up-collapse>summary").click();
      const text=clean(await forecast.textContent());
      for(const number of ["790.00","340.00","1,850.00","1,400.00"])assert.ok(text.includes(number),number);
      await forecast.locator(".follow-up-details>summary").click();
      const detail=clean(await forecast.textContent());
      for(const number of ["1,250.00","910.00","1,200.00","200.00"])assert.ok(detail.includes(number),number);
      assert.ok(!clean(await forecast.locator(".follow-up-payables").textContent()).includes("شراء الرودس"),"Paid inventory was counted a second time as unpaid");
      assert.match(detail,/لا يشمل مشتريات جديدة/);assert.match(detail,/لا يمثل رصيد البنك/);
      await fits(page,forecast,width);
      await forecast.evaluate(e=>{const main=document.querySelector(".app>main");main.scrollTop+=e.getBoundingClientRect().top-main.getBoundingClientRect().top-12;});
      await page.screenshot({path:path.join(output,`cash-forecast-${width}.png`)});
      await forecast.evaluate(e=>{const main=document.querySelector(".app>main");main.scrollTop+=Math.max(0,e.getBoundingClientRect().bottom-main.getBoundingClientRect().bottom)+12;});
      await page.screenshot({path:path.join(output,`cash-forecast-${width}-bottom.png`)});
      await page.getByLabel("شهر التقرير",{exact:true}).fill("2026-09");
      assert.match(clean(await forecast.locator(".follow-up-collapse>summary").textContent()),/790\.00/);
      assert.match(clean(await today.textContent()),/21\/10\/2026/);
    });
    await check(`Review actions open existing forms without changing accounts at ${width}px`,async()=>{
      await review.locator("summary").click();
      const observation=review.getByRole("button",{name:/خيل ملك خاص بلا تغذية/});await observation.waitFor();
      await observation.click();
      const form=page.getByRole("dialog");await form.waitFor();
      await form.getByRole("button",{name:"إغلاق",exact:true}).click();
      assert.deepEqual(await snapshot(page),baseline,"Viewing daily follow-up or review changed saved accounts");
    });
    await check(`Inventory explains the exact providing date and preserves stock/financial records at ${width}px`,async()=>{
      await page.getByRole("navigation",{name:"التنقل الرئيسي"}).getByRole("button",{name:"المخزون",exact:true}).click();
      const needs=page.getByRole("region",{name:"ملخص احتياج المخزون",exact:true});
      const runway=page.getByRole("region",{name:"مدة توفر الصنف",exact:true});await runway.waitFor();
      assert.match(clean(await needs.textContent()),/84\.00/);
      assert.match(clean(await runway.textContent()),/22\/10\/2026/);
      assert.doesNotMatch(clean(await runway.textContent()),/مدة التوريد|اشترِ قبل/);
      await fits(page,runway,width);
      await runway.screenshot({path:path.join(output,`inventory-providing-${width}.png`)});
      assert.deepEqual(await snapshot(page),baseline);
    });
    await context.close();
  }
  await check("Incomplete historical commitments are disclosed before expanding the forecast",async()=>{
    const context=await browser.newContext({viewport:{width:320,height:844},isMobile:true,hasTouch:true});
    await context.route("**/*",route=>new URL(route.request().url()).origin===new URL(base).origin?route.continue():route.abort());
    const page=await context.newPage();page.on("pageerror",e=>report.errors.push(e.message));
    await page.clock.install({time:new Date("2026-10-21T12:00:00Z")});
    await page.addInitScript(version=>localStorage.setItem("alatheel.release.read."+version,"yes"),require("../package.json").version);
    await page.goto(base+"/tests/ui/app.html?scenario=follow-up&incomplete=1");
    await page.locator(".daily-follow-up>summary").click();const panel=page.getByRole("region",{name:"توقع التحصيل والمدفوعات",exact:true});await panel.waitFor();
    assert.equal(await panel.locator("details[open]").count(),0);
    assert.match(clean(await panel.locator(".follow-up-collapse>summary").textContent()),/تقدير غير مكتمل/);
    await fits(page,panel,320);
    await panel.screenshot({path:path.join(output,"cash-forecast-incomplete-320.png")});
    await context.close();
  });
  assert.deepEqual(report.errors,[]);
})().catch(e=>{report.errors.push(e.message);console.error(e.stack);process.exitCode=1;}).finally(async()=>{
  await browser?.close();server?.kill();fs.writeFileSync(path.join(output,"follow-up-ui.json"),JSON.stringify(report,null,2));
});
