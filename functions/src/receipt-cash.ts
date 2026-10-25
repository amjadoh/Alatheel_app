import type { Row, State } from "./domain";

/** Receipt balances use active receipts; cash also includes linked closed-period corrections. */
export const activeReceipt = (r: Row) => !["pending", "void", "replaced"].includes(r.status);
export function receiptCash(s: Pick<State, "income">): Row[] {
  return s.income.flatMap(r => {
    const rows: Row[] = [];
    if (activeReceipt(r)) rows.push({ ...r, collectedAt: r.cashRecognitionAt || r.collectedAt });
    if (r.reversalAt && ["void", "replaced"].includes(r.status)) rows.push({
      id: r.id + "_reversal", sourceReceiptId: r.id, horseId: r.horseId,
      horseName: r.horseName, ownerId: r.ownerId, ownerName: r.ownerName,
      amount: -Number(r.amount), collectedAt: r.reversalAt,
      dueDate: r.dueDate, status: "collected", cashAdjustment: true,
      notes: r.changeReason, method: r.method,
    });
    return rows;
  });
}
