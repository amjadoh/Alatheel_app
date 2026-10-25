// Actual React screens; isolated fixtures. No GitHub, mail, production data or invites.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {spawn}=require('node:child_process'),{createRequire}=require('node:module');
const qa=process.env.QA_NODE_MODULES?createRequire(path.join(process.env.QA_NODE_MODULES,'_qa.cjs')):require;
const {chromium}=qa('playwright');
const output=path.resolve(process.env.QA_OUTPUT||'qa-results'),base=process.env.QA_BASE_URL||'http://127.0.0.1:5397';
let browser,server;const report={checks:[],errors:[]};fs.mkdirSync(output,{recursive:true});
async function check(name,fn){await fn();report.checks.push(name);console.log('PASS',name);}
const clean=value=>String(value).replace(/[\u2066-\u2069]/g,'');
async function pageFor(width,url){
 const page=await browser.newPage({viewport:{width,height:844},isMobile:true,hasTouch:true});
 page.on('pageerror',e=>report.errors.push(e.message));
 await page.route('**/*',route=>new URL(route.request().url()).origin===new URL(base).origin?route.continue():route.abort());
 await page.clock.install({time:new Date('2026-10-20T12:00:00Z')});
 await page.addInitScript(version=>localStorage.setItem('alatheel.release.read.'+version,'yes'),require('../package.json').version);
 await page.goto(base+url);return page;
}
(async()=>{
 try{
  if(!process.env.QA_BASE_URL){
   server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--config','vite.qa.config.ts','--port','5397','--strictPort'],{stdio:'ignore'});
   let ready=false;for(let i=0;i<100;i++){try{if((await fetch(base+'/tests/ui/app.html')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,200));}assert.ok(ready,'QA server unavailable');
  }
  browser=await chromium.launch({headless:true,...(process.env.QA_CHROME?{executablePath:process.env.QA_CHROME}:{})});
  for(const width of [320,390,430]){
   const page=await pageFor(width,'/tests/ui/app.html?scenario=feedback');
   const launch=page.locator('.feedback-launcher');await launch.waitFor();
   await check('Dedicated feedback lane never overlaps content or navigation '+width,async()=>{
    const b=await page.evaluate(()=>{const box=s=>{const r=document.querySelector(s).getBoundingClientRect();return{top:r.top,bottom:r.bottom,left:r.left,right:r.right};};return{main:box('.app>main'),lane:box('.feedback-launcher-lane'),button:box('.feedback-launcher'),nav:box('.bottom-nav'),viewport:innerWidth,scroll:document.documentElement.scrollWidth};});
    assert.ok(b.main.bottom<=b.lane.top+1&&b.lane.bottom<=b.nav.top+1);assert.ok(b.button.left>=0&&b.button.right<width/2);assert.ok(b.scroll<=b.viewport+1);
    await page.screenshot({path:path.join(output,'feedback-home-'+width+'.png')});
   });
   await launch.click();const modal=page.getByRole('dialog',{name:'ملاحظات التطبيق',exact:true});
   await modal.getByRole('button',{name:'ملاحظة جديدة',exact:true}).click();
   await check('Attachments preview/remove and ambiguous submit retry are safe '+width,async()=>{
    await modal.getByLabel('ملاحظتك',{exact:true}).fill('ملاحظة محلية للتحقق من الصور والمرفقات');
    const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aH2kAAAAASUVORK5CYII=','base64');
    await modal.getByLabel('اختيار صور الملاحظة',{exact:true}).setInputFiles({name:'فحص.png',mimeType:'image/png',buffer:png});
    await modal.getByLabel('اختيار مرفقات الملاحظة',{exact:true}).setInputFiles({name:'ملاحظة.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\nIsolated fixture\n%%EOF')});
    assert.equal(await modal.locator('.feedback-file').count(),2);assert.equal(await modal.locator('.feedback-thumbnail').count(),1);
    await modal.getByRole('button',{name:'حذف المرفق ملاحظة.pdf',exact:true}).click();assert.equal(await modal.locator('.feedback-file').count(),1);
    await modal.getByLabel('اختيار مرفقات الملاحظة',{exact:true}).setInputFiles({name:'ملاحظة.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\nIsolated fixture\n%%EOF')});
    await page.screenshot({path:path.join(output,'feedback-files-'+width+'.png')});
    await modal.getByRole('button',{name:'إرسال الملاحظة',exact:true}).click();
    await modal.getByRole('alert').filter({hasText:'انقطع تأكيد الشبكة'}).waitFor();
    await modal.getByRole('button',{name:'إرسال الملاحظة',exact:true}).click();
    await modal.getByRole('status').filter({hasText:'تم حفظ الملاحظة'}).waitFor();
    const saved=await page.evaluate(()=>window.__feedbackQA());assert.equal(saved.notes.length,1);assert.equal(saved.notes[0].syncState,'queued');
    assert.equal(saved.calls.filter(c=>c.action==='upload').length,2,'Retry must not reupload submitted files');
    assert.equal(new Set(saved.calls.map(c=>c.id)).size,1,'Ambiguous retry must keep the note id');
   });
   await modal.getByRole('button',{name:'إغلاق',exact:true}).click();
   const account=await pageFor(width,'/tests/ui/account.html?correction=1');
   await check('Receipt correction, required reason, void and balances fit RTL '+width,async()=>{
    await account.locator('.account-receipt summary').click();await account.getByRole('button',{name:'تصحيح الدفعة',exact:true}).click();
    const save=account.getByRole('button',{name:'حفظ تصحيح الدفعة',exact:true});assert.equal(await save.isDisabled(),true);
    await account.getByLabel('المبلغ المستلم (ريال)',{exact:true}).fill('800');await account.getByLabel('سبب التصحيح',{exact:true}).fill('المبلغ الصحيح 800');await save.click();
    const original=await account.evaluate(()=>window.__accountQA());assert.equal(original.income.length,2);assert.equal(original.income[0].status,'replaced');assert.equal(original.income[1].amount,800);
    assert.match(clean(await account.locator('.account-balance').textContent()),/2,700\.00/);
    await account.locator('.account-receipt').last().locator('summary').click();await account.getByRole('button',{name:'إلغاء الدفعة',exact:true}).click();
    await account.getByLabel('سبب الإلغاء',{exact:true}).fill('تسجيل بالخطأ');await account.getByRole('button',{name:'تأكيد إلغاء الدفعة',exact:true}).click();
    assert.match(clean(await account.locator('.account-balance').textContent()),/3,500\.00/);
    const canceled=await account.evaluate(()=>window.__accountQA());assert.equal(canceled.income[1].status,'void');
    const fits=await account.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1);assert.ok(fits);
    await account.screenshot({path:path.join(output,'receipt-correction-'+width+'.png')});
   });
   await account.close();await page.close();
  }
  for(const scenario of ['feedback-employee','owner-alerts']){
   const p=await pageFor(390,'/tests/ui/app.html?scenario='+scenario);await p.getByRole('navigation',{name:'التنقل الرئيسي'}).waitFor();
   await check('Non-admin cannot see feedback launcher '+scenario,async()=>assert.equal(await p.locator('.feedback-launcher').count(),0));await p.close();
  }
  const employee=await pageFor(390,'/tests/ui/account.html?correction=1&role=employee');await employee.locator('.account-receipt summary').click();
  await check('Employee may record payments but cannot correct or void',async()=>{assert.equal(await employee.getByRole('button',{name:'تصحيح الدفعة',exact:true}).count(),0);assert.equal(await employee.getByRole('button',{name:'إلغاء الدفعة',exact:true}).count(),0);});
  assert.deepEqual(report.errors,[]);report.passed=true;
 }finally{fs.writeFileSync(path.join(output,'receipt-feedback-report.json'),JSON.stringify(report,null,2));if(browser)await browser.close();if(server)server.kill();}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
