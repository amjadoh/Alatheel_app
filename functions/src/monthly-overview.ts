import type {State} from './domain';
import {money,nextMonth} from './domain';
import {accountingStart,accountingView} from './accounting-boundary';
import {financialSummary,expensePlan,expensePaid,monthEnd,expensePeriodState,cashCategory} from './finance';
import {monthlyExpense,isFeedPurchase} from './estimates';
import {horseAccount} from './accounts';
import {businessDay} from './dates';

export function monthlyOverview(input:State,month:string,today:string){
 const s=accountingView(input),f=financialSummary(s,month),end=monthEnd(month),asOf=[end,today].sort()[0];
 let oldOwner=0,currentOwner=0,oldUnpaid=0,currentUnpaid=0;
 const owners=s.horses.filter(h=>h.status!=='private'&&h.previousStatus!=='private').map(h=>{
  const account=horseAccount(s,h,asOf,end);let old=0,current=0;
  for(const item of account.items){const m=item.dueDate.slice(0,7);if(m<month)old+=item.remaining;else if(m===month)current+=item.remaining;}
  oldOwner+=old;currentOwner+=current;return {horse:h,old:money(old),current:money(current),remaining:money(old+current)};
 });
 const payables:Array<{expenseId:string;name:string;period:string;remaining:number}>=[];
 // Removing a recurring definition must not erase unpaid liabilities in frozen months.
 const definitions=new Map(s.expenses.map(e=>[e.id,e]));
 for(const p of s.financialPeriods.filter(p=>p.closed&&p.id<=month).sort((a,b)=>a.id.localeCompare(b.id)))
  for(const e of p.basis?.expenses||[])if(!definitions.has(e.id))definitions.set(e.id,e);
 for(const e of definitions.values()){
  const first=accountingStart(s).slice(0,7)||e.startMonth||businessDay(e.incurredAt||e.createdAt).slice(0,7)||month;
  let cursor=first,count=0;
  while(cursor<=month&&count++<120){const remaining=money(Math.max(0,expensePlan(s,e,cursor)-expensePaid(s,e.id,cursor)));if(remaining>0){payables.push({expenseId:e.id,name:e.name,period:cursor,remaining});if(cursor<month)oldUnpaid+=remaining;else currentUnpaid+=remaining;}cursor=nextMonth(cursor+'-01').slice(0,7);}
 }
 const basis=expensePeriodState(s,month),salaryPlan=money(basis.expenses.filter(e=>!isFeedPurchase(basis,e)&&cashCategory(e)==='salary').reduce((n,e)=>n+monthlyExpense(e,month),0));
 return {...f,salaryPlan,otherPlan:money(f.other-salaryPlan),cost:money(f.plannedPayments),coverageDifference:money(f.collected-f.plannedPayments),oldOwner:money(oldOwner),currentOwner:money(currentOwner),ownerBalance:money(oldOwner+currentOwner),oldUnpaid:money(oldUnpaid),currentUnpaid:money(currentUnpaid),unpaid:money(oldUnpaid+currentUnpaid),owners,payables};
}
