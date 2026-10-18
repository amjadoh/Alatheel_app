export const RELEASE_VERSION = "1.8.3";
export const RELEASE_NOTES = [
  { title: "حسابك · أعلى اليسار", items: [
    "تم تحسين حفظ تسجيل الدخول لمدة 7 أيام عند إغلاق التطبيق وإعادة فتحه.",
    "تمت إضافة استعادة الحساب عند عودة الاتصال، دون طلب تسجيل الدخول مجددًا بسبب تعذر التحقق المؤقت.",
  ] },
];
const key = "alatheel.release.read." + RELEASE_VERSION;
type Store = Pick<Storage, "getItem" | "setItem">;
let readInSession = false;
export function needsReleaseNotes(store: Store) {
  try {
    return !readInSession && store.getItem(key) !== "yes";
  } catch {
    return !readInSession;
  }
}
export function markReleaseNotesRead(store: Store) {
  readInSession = true;
  try {
    store.setItem(key, "yes");
  } catch {
    /* Retain dismissal in this session if device storage is unavailable. */
  }
}
