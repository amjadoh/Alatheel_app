import { useEffect } from "react";
import { createRoot } from "react-dom/client";
import {
  UpdateButton,
  UpdateGate,
  useAppUpdate,
  type UpdaterPlugin,
} from "../../src/updates";
import "@fontsource/noto-sans-arabic/400.css";
import "@fontsource/noto-sans-arabic/600.css";
import "@fontsource/noto-sans-arabic/800.css";
import "../../src/style.css";

const updater: UpdaterPlugin = {
  async check() {
    return {
      available: false,
      versionName: "1.11.1",
      notes: "",
      ready: false,
    };
  },
  async download() {},
  async install() {
    return { permissionRequired: false };
  },
  async addListener() {
    return { async remove() {} };
  },
};

function Preview() {
  const { setPrimaryAccess } = useAppUpdate();
  useEffect(() => setPrimaryAccess(true), []);
  return (
    <div className="app" dir="rtl">
      <header>
        <div>
          <b>حسابي</b>
          <span>مدير الإسطبل الأساسي</span>
        </div>
      </header>
      <main>
        <div className="content">
          <section className="card">
            <h3>بيانات الحساب</h3>
            <p className="muted small">amjad@example.test</p>
          </section>
          <p className="muted small center">
            الأثيل · الإصدار 1.11.1 · أندرويد
          </p>
          <UpdateButton />
        </div>
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <UpdateGate android client={updater}>
    <Preview />
  </UpdateGate>,
);
