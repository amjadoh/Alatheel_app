import {test} from 'node:test';
import assert from 'node:assert/strict';
import {purchasePeriod} from '../functions/src/dates';
import {applyCommand,emptyState,type State} from '../functions/src/domain';
import {expensePaid,financialSummary} from '../functions/src/finance';
import {monthlyOverview} from '../functions/src/monthly-overview';
const actor={uid:'admin',role:'admin' as const,displayName:'مدير'};
function seed(){const s=emptyState();s.mealTypes=[{id:'feed',name:'رودس',unit:'ربطة',currentStock:0,pricePerUnit:20}];return s;}
function buy(s:State,paidAt:string,costPeriod?:string){return applyCommand(s,actor,{action:'stock.purchase',id:'feed',requestId:'purchase_one',data:{amount:10,total:200,paidAt,costPeriod,method:'cash'}},'2026-10-28T10:00:00Z');}
test('purchase cycle ends on 27 and starts on 28 including December rollover',()=>{
 assert.equal(purchasePeriod('2026-10-27'),'2026-10');assert.equal(purchasePeriod('2026-10-28'),'2026-11');assert.equal(purchasePeriod('2026-12-28'),'2027-01');assert.equal(purchasePeriod('2026-11-01'),'2026-11');
});
test('purchase paid October 27 for November creates one November cost and October cash movement',()=>{
 const s=buy(seed(),'2026-10-27','2026-11');assert.equal(s.mealTypes[0].currentStock,10);assert.equal(s.expenses.length,1);assert.equal(s.expensePayments.length,1);
 assert.equal(financialSummary(s,'2026-10').purchases,0);assert.equal(financialSummary(s,'2026-10').inventoryPaid,200);
 assert.equal(financialSummary(s,'2026-11').purchases,200);assert.equal(financialSummary(s,'2026-11').inventoryPaid,0);
 assert.equal(expensePaid(s,s.expenses[0].id,'2026-11'),200);assert.equal(monthlyOverview(s,'2026-11','2026-11-03').unpaid,0);
});
test('October 28 purchase defaults to November; 27 remains October',()=>{assert.equal(buy(seed(),'2026-10-28').expenses[0].costPeriod,'2026-11');assert.equal(buy(seed(),'2026-10-27').expenses[0].costPeriod,'2026-10');});
test('explicit period correction of a live purchase preserves invoice cash date and single payment',()=>{
 let s=buy(seed(),'2026-10-27','2026-11');s=applyCommand(s,actor,{action:'stock.purchase.correct',id:'purchase_one',requestId:'correction',data:{amount:12,total:240,reason:'فاتورة مصححة',expectedCorrectionId:'purchase_one'}},'2026-10-28T10:00:00Z');
 assert.equal(financialSummary(s,'2026-11').purchases,240);assert.equal(financialSummary(s,'2026-10').inventoryPaid,240);assert.equal(s.expensePayments.length,1);assert.equal(s.expensePayments[0].paidAt,'2026-10-27');assert.equal(s.expensePayments[0].period,'2026-11');
});
test('closed cost period is rejected without changing stock or cash',()=>{const s=seed();s.financialPeriods=[{id:'2026-11',closed:true}];const old=structuredClone(s);assert.throws(()=>buy(s,'2026-10-27','2026-11'),/مغلق/);assert.deepEqual(s,old);assert.throws(()=>buy(seed(),'2026-10-27','2026-13'),/الفترة/);});
test('legacy invoices retain their original calendar month without reinterpretation',()=>{const s=seed();s.expenses=[{id:'legacy',cost:200,frequency:'once',incurredAt:'2026-09-28',expenseKind:'feed_purchase'}];assert.equal(financialSummary(s,'2026-09').purchases,200);assert.equal(financialSummary(s,'2026-10').purchases,0);});

