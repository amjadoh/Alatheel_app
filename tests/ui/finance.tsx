import { useState } from "react";
import { createRoot } from "react-dom/client";
import { emptyState, applyCommand } from "../../functions/src/domain";
import {
  FinancialDashboard,
  HorseFinancialPanel,
  HorsePhoto,
} from "../../src/finance-ui";
import type { Row } from "../../functions/src/domain";
import { prepareHorsePhoto } from "../../src/horse-photo";
import "@fontsource/noto-sans-arabic/400.css";
import "@fontsource/noto-sans-arabic/800.css";
import "../../src/style.css";
const initial = emptyState();
initial.mealTypes = [
  { id: "feed", name: "مركزات", unit: "كيس 40 كجم", pricePerUnit: 90 },
];
initial.horses = [
  {
    id: "h1",
    name: "خيل للتجربة",
    ownerName: "مالك للتجربة",
    status: "boarding",
    boardingFee: 800,
    dueDate: "2026-10-01",
    feeding: [{ mealTypeId: "feed", quantity: 3 }],
    photoURL: `${location.origin}/horses.jpg`,
  },
];
initial.expenses = [
  {
    id: "salary",
    name: "راتب العامل",
    cost: 1800,
    frequency: "monthly",
    allocationScope: "all_active",
  },
  {
    id: "feedbuy",
    name: "مركزات",
    mealTypeId: "feed",
    expenseKind: "feed_purchase",
    frequency: "monthly",
    cost: 1530,
  },
];
initial.income = [
  {
    id: "receipt",
    horseId: "h1",
    amount: 800,
    boardingFee: 800,
    dueDate: "2026-09-01",
    collectedAt: "2026-10-10T12:00:00Z",
  },
];
function Preview() {
  const [state, setState] = useState(initial),
    [horse, setHorse] = useState<Row | null>(null),
    [page, setPage] = useState("");
  const photoTest = async () => {
    const response = await fetch("/horses.jpg");
    const photoURL = await prepareHorsePhoto(
      new File([await response.blob()], "test-horse.jpg", {
        type: "image/jpeg",
      }),
    );
    const updated = { ...state.horses[0], photoURL };
    setState({ ...state, horses: [updated] });
    if (horse) setHorse(updated);
  };
  return (
    <div className="app">
      <header>
        <b>إسطبل الأثيل</b>
        <span className="pill">محاكاة — بيانات افتراضية</span>
      </header>
      <main>
        <div className="content">
          <button className="button outline" onClick={() => void photoTest()}>
            اختبار صورة الخيل
          </button>
          {horse ? (
            <>
              <button className="button outline" onClick={() => setHorse(null)}>
                رجوع للداشبورد
              </button>
              <HorsePhoto horse={horse} large />
              <HorseFinancialPanel
                state={state}
                horse={horse}
                month="2026-10"
                staff
              />
            </>
          ) : (
            <FinancialDashboard
              state={state}
              month="2026-10"
              onGo={setPage}
              onHorse={setHorse}
              admin
              onSave={() =>
                setState(
                  applyCommand(
                    state,
                    { uid: "test", role: "admin", displayName: "تجربة" },
                    {
                      action: "finance.snapshot",
                      requestId: "snapshot_preview",
                      data: { month: "2026-10" },
                    },
                    "2026-10-15T12:00:00Z",
                  ),
                )
              }
            />
          )}
          {page && <p role="status">الوجهة المختارة: {page}</p>}
        </div>
      </main>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<Preview />);
