// Local-only composition of the real app and update gate. The QA Vite config
// substitutes only the service; this file is not a production entry point.
import { createRoot } from "react-dom/client";
import { useEffect } from "react";
import App from "../../src/App";
import { UpdateGate, useAppUpdate, type UpdaterPlugin } from "../../src/updates";
import { markReleaseNotesRead } from "../../src/release-notes";
import "@fontsource/noto-sans-arabic/400.css";
import "@fontsource/noto-sans-arabic/600.css";
import "@fontsource/noto-sans-arabic/800.css";
import "../../src/style.css";

const params = new URLSearchParams(location.search);
const qa = {
  timings: { mounted: performance.now() } as Record<string, number>,
  updateChecks: 0,
  downloads: 0,
  installs: 0,
};
(window as any).__startupQA = qa;
markReleaseNotesRead(localStorage);
let downloaded = false;
const updater: UpdaterPlugin = {
  async check() {
    qa.updateChecks++;
    qa.timings.updateStarted = performance.now();
    await new Promise((resolve) => setTimeout(resolve, Number(params.get("updateDelay") || 160)));
    qa.timings.updateFinished = performance.now();
    const outcome = qa.updateChecks > 1 ? params.get("updateAfterFirst") || params.get("update") : params.get("update");
    if(outcome === "failed") throw new Error("تعذر التحقق من التحديث التجريبي");
    return {available:outcome === "required", versionName:"99.0.0", notes:"تحديث تجريبي معزول", ready:downloaded};
  },
  async download() { qa.downloads++; await new Promise(resolve=>setTimeout(resolve,Number(params.get("downloadDelay") || 0))); downloaded=true; },
  async install() { qa.installs++; await new Promise(resolve=>setTimeout(resolve,Number(params.get("installDelay") || 0))); return {permissionRequired:false}; },
  async addListener() { return {async remove() {}}; },
};
const visible = (element: Element) => {
  const style = getComputedStyle(element);
  return element.getClientRects().length > 0 && style.display !== "none" && style.visibility !== "hidden";
};
new MutationObserver(() => {
  const logo = [...document.querySelectorAll(".startup-screen img")].find(visible);
  if(logo && !qa.timings.logoVisible) qa.timings.logoVisible = performance.now();
  const dashboard = [...document.querySelectorAll(".quick-actions")].find(visible);
  if(dashboard && !qa.timings.dashboardVisible) qa.timings.dashboardVisible = performance.now();
  const googleEntry = [...document.querySelectorAll("button")].find((b) => visible(b) && b.textContent?.includes("دخول الأعضاء باستخدام Google"));
  if(googleEntry && !qa.timings.googleEntryVisible) qa.timings.googleEntryVisible = performance.now();
}).observe(document.getElementById("root")!, {subtree:true, childList:true, attributes:true});

function UpdateTestControl() {
  const { check } = useAppUpdate();
  useEffect(() => { (window as any).__startupForceCheck = check; }, [check]);
  return null;
}
const root = createRoot(document.getElementById("root")!);
(window as any).__startupUnmount = () => root.unmount();
root.render(<UpdateGate android client={updater}><UpdateTestControl /><App /></UpdateGate>);
