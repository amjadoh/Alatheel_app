import { createRoot } from "react-dom/client";
import { FeedbackPanel } from "../../src/feedback";
import "../../src/style.css";
import "@fontsource/noto-sans-arabic/400.css";
const primary = !new URLSearchParams(location.search).has("secondary");
createRoot(document.getElementById("root")!).render(
  <main>
    <FeedbackPanel
      actor={{
        uid: "qa",
        role: "admin",
        displayName: "مدير تجريبي",
        dataReady: true,
      }}
      primary={primary}
      onBusy={() => {}}
    />
  </main>,
);
