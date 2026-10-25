import type { State, Row } from './domain';
import { businessDay } from './dates';

export function accountingStart(s: Pick<State, 'settings'>) {
  return String(s.settings.find(x => x.accountingStartDate)?.accountingStartDate || '');
}
/** A calculation view only: original dates, documents and audit trails are untouched. */
export function accountingView(s: State): State {
  const start = accountingStart(s);
  if (!start || (s as any).__accountingView) return s;
  const inventoryPolicy = s.settings.some(x => x.inventoryPurchasesFromExpenses === true);
  const present = (r: Row) => !businessDay(r.entryDate) || businessDay(r.entryDate) >= start ? r : {
    ...r, entryDate: start,
    ...(r.stayPeriods?.length ? {stayPeriods:r.stayPeriods.filter((p:Row)=>!p.exitDate || businessDay(p.exitDate)>=start).map((p:Row)=>({...p,entryDate:businessDay(p.entryDate)<start?start:p.entryDate}))}:{}),
  };
  const view = {...s,
    horses:s.horses.map(present),
    expenses:s.expenses.filter(e=>!(inventoryPolicy && e.expenseKind==='feed_purchase' && e.frequency!=='once' && !e.stockTransactionId)).map(e=>({...e,accountingStartDate:start})),
    expensePayments:s.expensePayments.filter(p=>businessDay(p.paidAt)>=start),
    income:s.income.filter(p=>!p.collectedAt || businessDay(p.collectedAt)>=start),
    financialPeriods:s.financialPeriods.filter(p=>p.id>=start.slice(0,7)),
  };
  Object.defineProperty(view,'__accountingView',{value:true});
  return view;
}

export function boundedExpense(e: Row, month: string, days: number) {
  const start = [String(e.accountingStartDate||''),String(e.accrualStartDate||'')].sort().pop()!;
  if (!start) return {days,blocked:false};
  if (month<start.slice(0,7)) return {days:0,blocked:true};
  return {days:month===start.slice(0,7)?days-Number(start.slice(8,10))+1:days,blocked:false};
}
