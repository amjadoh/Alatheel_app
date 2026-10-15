// Local-only UI fixture; Vite production build only includes the root index.html.
import { createRoot } from "react-dom/client";
import { UpdateGate, UpdaterPlugin } from "../../src/updates";
import "@fontsource/noto-sans-arabic/400.css";
import "@fontsource/noto-sans-arabic/800.css";
import "../../src/style.css";
const scenario = new URLSearchParams(location.search).get("scenario");
let retries = 0,
  downloaded = false,
  installs = 0;
let progress = (_: { percent: number }) => {};
const client: UpdaterPlugin = {
  async check() {
    if (scenario === "offline" && retries++ === 0)
      throw new Error(
        "تعذر التحقق من التحديث. تحقق من الإنترنت وأعد المحاولة.",
      );
    return {
      available: scenario !== "current",
      versionName: "1.5.0",
      notes: "تحسينات وإصلاحات للتطبيق",
      ready: downloaded,
    };
  },
  async download() {
    progress({ percent: 100 });
    if (scenario === "download-error")
      throw new Error("تعذر تنزيل التحديث أو التحقق منه. أعد المحاولة.");
    downloaded = true;
  },
  async install() {
    return { permissionRequired: ++installs === 1 };
  },
  async addListener(_, fn) {
    progress = fn;
    return { async remove() {} };
  },
};
createRoot(document.getElementById("root")!).render(
  <UpdateGate android client={client}>
    <main>
      <h1>واجهة التطبيق للاختبار</h1>
      <button>عملية محمية</button>
    </main>
  </UpdateGate>,
);
