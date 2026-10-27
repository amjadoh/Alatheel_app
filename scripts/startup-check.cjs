// Isolated simulated startup timings. These are not handset performance claims.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { createRequire } = require("node:module");
const requireQA = process.env.QA_NODE_MODULES ? createRequire(path.join(process.env.QA_NODE_MODULES,"_qa.cjs")) : require;
const { chromium } = requireQA("playwright");
const output = path.resolve(process.env.QA_OUTPUT || "qa-results");
const base = process.env.QA_BASE_URL || `http://127.0.0.1:${process.env.QA_STARTUP_PORT || 5194}`;
const report = {scope:"Isolated simulated app startup; not a measurement on the user's phone",checks:[],measurements:[],errors:[]};
let server, browser;
fs.mkdirSync(output,{recursive:true});
const pause = ms => new Promise(resolve=>setTimeout(resolve,ms));
async function check(name, fn) { await fn(); report.checks.push(name); console.log("PASS",name); }
async function open(parameters = {}, width = 390) {
  const context = await browser.newContext({viewport:{width,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:1});
  await context.route("**/*", route => new URL(route.request().url()).origin === new URL(base).origin ? route.continue() : route.abort());
  const page = await context.newPage();
  page.on("pageerror", e=>report.errors.push(e.message));
  await page.goto(base+"/tests/ui/startup.html?"+new URLSearchParams({scenario:"startup",...parameters}),{waitUntil:"domcontentloaded"});
  await page.waitForFunction(()=>!!window.__startupQA);
  return {page,context};
}
async function measurement(page, label) {
  const value = await page.evaluate(()=>window.__startupQA);
  report.measurements.push({label,...value});
  assert.equal(value.timings.googleEntryVisible,undefined,"A saved-session startup flashed the Google sign-in entry");
  return value;
}
async function noActions(page) {
  assert.equal(await page.getByRole("button",{name:"إضافة خيل",exact:true}).count(),0);
  assert.equal(await page.getByRole("button",{name:"دخول الأعضاء باستخدام Google",exact:false}).count(),0);
  assert.equal(await page.locator(".quick-actions:visible").count(),0);
}
(async()=>{
  if(!process.env.QA_BASE_URL) {
    server=spawn(process.execPath,["node_modules/vite/bin/vite.js","--config","vite.qa.config.ts","--port",new URL(base).port,"--strictPort"],{stdio:"ignore"});
    let ready=false;
    for(let i=0;i<120;i++) { try { if((await fetch(base+"/tests/ui/startup.html")).ok){ready=true;break;} } catch {} await pause(200); }
    assert.ok(ready,"Isolated startup server did not start");
  }
  browser=await chromium.launch({headless:true,...(process.env.QA_CHROME?{executablePath:process.env.QA_CHROME}:{})});
  for(const width of [320,390,430]) {
    const {page,context}=await open({authDelay:"900",dataDelay:"1600",readyDelay:"2200",updateDelay:"300"},width);
    await check(`Branded startup fits RTL at ${width}px without a sign-in or financial-data flash`,async()=>{
      const progress=page.getByRole("progressbar",{name:"تقدم فتح الأثيل"});
      await progress.waitFor();
      await noActions(page);
      const dimensions=await page.locator(".startup-screen").evaluate(e=>({direction:getComputedStyle(e).direction,left:e.getBoundingClientRect().left,right:e.getBoundingClientRect().right,scroll:document.documentElement.scrollWidth,viewport:innerWidth}));
      assert.equal(dimensions.direction,"rtl");
      assert.ok(dimensions.left>=0&&dimensions.right<=width+1&&dimensions.scroll<=width+1,JSON.stringify(dimensions));
      await page.screenshot({path:path.join(output,`startup-${width}.png`)});
      await page.waitForFunction(()=>!!window.__startupQA.timings.dataArrived);
      await noActions(page);
      await page.getByRole("button",{name:"إضافة خيل",exact:true}).waitFor();
      const result=await measurement(page,`normal-${width}`);
      assert.ok(result.timings.dashboardVisible>=result.timings.financialReady);
      assert.ok(result.timings.dashboardVisible>=result.timings.updateFinished);
      assert.ok(result.timings.dashboardVisible-result.timings.financialReady<700,"Ready app waited for an unnecessary animation delay");
      assert.ok(result.timings.logoVisible<result.timings.authReady,"Logo was not shown during session restoration");
    });
    await context.close();
  }
  await check("Fast startup opens immediately after its actual prerequisites",async()=>{
    const {page,context}=await open({authDelay:"20",dataDelay:"50",readyDelay:"80",updateDelay:"40"});
    await page.getByRole("button",{name:"إضافة خيل",exact:true}).waitFor();
    const result=await measurement(page,"fast-ready");
    const last=Math.max(result.timings.financialReady,result.timings.updateFinished);
    assert.ok(result.timings.dashboardVisible-last<700,"Animation introduced a minimum startup wait");
    await context.close();
  });
  await check("Horse deep links wait for complete financial data and open details stay current", async()=>{
    const {page,context}=await open({horse:"horse",earlyHorse:"1",authDelay:"60",dataDelay:"550",readyDelay:"900",updateDelay:"40"});
    await page.waitForFunction(()=>!!window.__startupQA.timings.earlyHorse);
    await page.waitForTimeout(80);
    assert.equal(new URL(page.url()).searchParams.get("horse"),"horse","Deep link consumed incomplete horse data");
    assert.equal(await page.getByRole("dialog",{name:"خيل تجريبي",exact:true}).count(),0);
    await noActions(page);
    const dialog=page.getByRole("dialog",{name:"خيل تجريبي",exact:true});
    await dialog.waitFor();
    assert.equal(new URL(page.url()).searchParams.get("horse"),null);
    const total=dialog.locator(".finance-mini-grid > div").filter({has:page.getByText("تكلفته المقدّرة",{exact:true})}).locator("b");
    const expected=await page.evaluate(()=>window.__startupExpectedHorseFinance().total);
    const text=()=>total.textContent().then(value=>String(value).replace(/[\u2066-\u2069]/g,""));
    assert.ok((await text()).includes(expected.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})),"Detail retained the partial startup financial snapshot");
    await page.evaluate(()=>window.__startupChangePrice());
    const revised=await page.evaluate(()=>window.__startupExpectedHorseFinance().total);
    assert.ok(revised>expected);
    await page.waitForFunction(expected=>{
      const row=[...document.querySelectorAll("dialog .finance-mini-grid > div")].find(element=>element.textContent.includes("تكلفته المقدّرة"));
      return row?.textContent.replace(/[\u2066-\u2069]/g,"").includes(expected);
    },revised.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2}));
    await context.close();
  });
  await check("A slower mandatory version check prevents early dashboard access",async()=>{
    const {page,context}=await open({authDelay:"40",dataDelay:"80",readyDelay:"120",updateDelay:"900"});
    await page.waitForFunction(()=>!!window.__startupQA.timings.financialReady);
    await noActions(page);
    await page.getByRole("button",{name:"إضافة خيل",exact:true}).waitFor();
    const result=await measurement(page,"slow-update");
    assert.ok(result.timings.dashboardVisible>=result.timings.updateFinished);
    await context.close();
  });
  await check("An available update remains mandatory after authentication and financial readiness",async()=>{
    const {page,context}=await open({authDelay:"40",dataDelay:"80",readyDelay:"120",updateDelay:"300",update:"required"});
    await page.getByRole("heading",{name:"حدّث التطبيق للمتابعة"}).waitFor();
    await noActions(page);
    const result=await measurement(page,"required-update");
    assert.equal(result.timings.dashboardVisible,undefined);
    assert.equal(result.downloads,0);assert.equal(result.installs,0);
    await context.close();
  });
  await check("Stable is default and switching to beta rechecks and persists the selected channel",async()=>{
    const {page,context}=await open({authDelay:"40",dataDelay:"80",readyDelay:"120",updateDelay:"80",update:"required",updateAfterFirst:"current"});
    await page.getByRole("heading",{name:"حدّث التطبيق للمتابعة"}).waitFor();
    assert.deepEqual(await page.evaluate(()=>window.__startupQA.updateChannels),["stable"]);
    await page.getByRole("button",{name:"Bata",exact:true}).click();
    await page.getByRole("button",{name:"إضافة خيل",exact:true}).waitFor();
    const result=await page.evaluate(()=>({channels:window.__startupQA.updateChannels,stored:localStorage.getItem("alatheel.update.channel")}));
    assert.deepEqual(result.channels,["stable","beta"]);
    assert.equal(result.stored,"beta");
    await context.close();
  });
  await check("A failed initial update check stays blocked with a retry action",async()=>{
    const {page,context}=await open({authDelay:"40",dataDelay:"80",readyDelay:"120",updateDelay:"300",update:"failed"});
    await page.getByRole("heading",{name:"تعذر التحقق من الإصدار"}).waitFor();
    await noActions(page);
    const result=await measurement(page,"failed-update");
    assert.equal(result.timings.dashboardVisible,undefined);
    assert.ok(await page.getByRole("button",{name:/إعادة/}).count()>0);
    await context.close();
  });
  await check("Update notifications during an active check coalesce into one forced follow-up",async()=>{
    const {page,context}=await open({authDelay:"40",dataDelay:"80",readyDelay:"120",updateDelay:"350"});
    await page.waitForFunction(()=>window.__startupQA.updateChecks===1&&!!window.__startupForceCheck);
    await page.evaluate(()=>{for(let i=0;i<4;i++)window.__startupForceCheck();});
    await page.getByRole("button",{name:"إضافة خيل",exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>window.__startupQA.updateChecks),2);
    await page.waitForTimeout(400);
    assert.equal(await page.evaluate(()=>window.__startupQA.updateChecks),2,"Queued request caused an endless verification loop");
    await context.close();
  });
  await check("A queued forced check does not run after the update gate unmounts",async()=>{
    const {page,context}=await open({authDelay:"40",dataDelay:"80",readyDelay:"120",updateDelay:"350"});
    await page.waitForFunction(()=>window.__startupQA.updateChecks===1&&!!window.__startupForceCheck);
    await page.evaluate(()=>{window.__startupForceCheck();window.__startupUnmount();});
    await page.waitForTimeout(450);
    assert.equal(await page.evaluate(()=>window.__startupQA.updateChecks),1);
    await context.close();
  });
  await check("Notifications during download and installation defer one check and cannot unlock a known update",async()=>{
    const {page,context}=await open({authDelay:"40",dataDelay:"80",readyDelay:"120",updateDelay:"100",update:"required",updateAfterFirst:"current",downloadDelay:"350",installDelay:"350"});
    await page.getByRole("button",{name:"تنزيل التحديث وتثبيته",exact:true}).click();
    await page.waitForFunction(()=>window.__startupQA.downloads===1);
    await page.evaluate(()=>{window.__startupForceCheck();window.__startupForceCheck();});
    assert.equal(await page.evaluate(()=>window.__startupQA.updateChecks),1);
    await page.waitForFunction(()=>window.__startupQA.installs===1);
    await page.evaluate(()=>window.__startupForceCheck());
    await page.getByRole("button",{name:"تثبيت التحديث",exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>window.__startupQA.updateChecks),2);
    await noActions(page);
    await page.waitForTimeout(200);
    assert.equal(await page.evaluate(()=>window.__startupQA.updateChecks),2);
    await context.close();
  });
  await check("Failure after a required update remains mandatory and keeps its release details",async()=>{
    const {page,context}=await open({authDelay:"40",dataDelay:"80",readyDelay:"120",updateDelay:"100",update:"required",updateAfterFirst:"failed"});
    await page.getByRole("heading",{name:"حدّث التطبيق للمتابعة"}).waitFor();
    await page.evaluate(()=>window.__startupForceCheck());
    await page.getByRole("button",{name:"إعادة المحاولة",exact:true}).waitFor();
    assert.equal(await page.getByText("الإصدار 99.0.0",{exact:true}).count(),1);
    await noActions(page);
    assert.equal((await measurement(page,"known-update-after-failure")).timings.dashboardVisible,undefined);
    await context.close();
  });
  for(const state of ["waiting","blocked"]) await check(`Authentication ${state} keeps data hidden and offers recovery without a Google flash`,async()=>{
    const {page,context}=await open({authDelay:"60",authFailure:state,updateDelay:"30"});
    await page.getByRole("button",{name:"إعادة المحاولة",exact:true}).waitFor();
    await noActions(page);
    const result=await measurement(page,`auth-${state}`);
    assert.equal(result.timings.dashboardVisible,undefined);
    await context.close();
  });
  assert.deepEqual(report.errors,[]);
})().catch(e=>{report.errors.push(e.message);console.error(e.stack);process.exitCode=1;}).finally(async()=>{
  await browser?.close();server?.kill();
  fs.writeFileSync(path.join(output,"startup-timing.json"),JSON.stringify(report,null,2));
});
