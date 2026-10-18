export const RELEASE_VERSION = "1.9.0";
export const RELEASE_NOTES = [
  { title: "المخزون · الشريط السفلي", items: [
    "تمت إضافة داشبورد يوضح المتوفر، واحتياج التغذية حتى نهاية يوم 27، والناقص للشراء وقيمته التقديرية.",
    "تمت إضافة تفاصيل احتياج كل خيل حسب الكمية والمواعيد المسجلة، مع دعم الربطة بكسورها والكيلو حسب الصنف.",
    "دورة تخطيط المخزون من 28 إلى 27. الوجبات المخصومة والمتخطاة لا تُطلب مرة ثانية، والحسابات المالية الشهرية تبقى محفوظة.",
    "قيمة الشراء المتوقعة للتخطيط فقط؛ يُسجل المصروف مرة واحدة عند شراء المخزون فعليًا.",
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
