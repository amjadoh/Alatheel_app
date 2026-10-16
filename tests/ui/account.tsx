import { useState } from "react";
import { createRoot } from "react-dom/client";
import { HorseAccount } from "../../src/account-ui";
import { emptyState, applyCommand } from "../../functions/src/domain";
import { businessDay } from "../../functions/src/dates";
import "@fontsource/noto-sans-arabic/400.css";
import "@fontsource/noto-sans-arabic/800.css";
import "../../src/style.css";
const initial = emptyState(),
  today = businessDay(new Date().toISOString());
initial.horses = [
  {
    id: "h",
    name: "خيل تجريبي",
    ownerName: "مالك تجريبي",
    ownerId: "o",
    status: "boarding",
    entryDate: "2026-06-01",
    dueDate: "2026-06-01",
    boardingFee: 700,
  },
];
function Preview() {
  const [s, setState] = useState(initial);
  return (
    <div className="app">
      <header>
        <b>الأثيل · فحص محلي</b>
        <span>بيانات تجريبية فقط</span>
      </header>
      <main>
        <div className="content">
          <HorseAccount
            state={s}
            horse={s.horses[0]}
            canPay
            onPay={async (data) => {
              setState(
                applyCommand(
                  s,
                  { uid: "admin", role: "admin", displayName: "مدير تجريبي" },
                  {
                    action: "income.pay",
                    id: "h",
                    requestId: crypto.randomUUID(),
                    data,
                  },
                  today + "T12:00:00Z",
                ),
              );
            }}
          />
        </div>
      </main>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<Preview />);
