export const RELEASE_VERSION = "1.10.0";
export const RELEASE_NOTES = [
  { title: "فتح التطبيق والحساب", items: [
    "تمت إضافة شاشة فتح بشعار الإسطبل وشريط تقدم، مع تقليل الانتظار عند فتح التطبيق والرجوع إليه.",
    "يبقى تسجيل الدخول محفوظًا لمدة 7 أيام، ويظل تحديث التطبيق إلزاميًا عند توفر إصدار جديد.",
  ] },
  { title: "الرئيسية", items: [
    "تمت إضافة «يحتاج إجراء اليوم» لمتابعة استحقاقات التحصيل والمتأخرات والمخزون الذي يحتاج توفيرًا وطلبات الخيل.",
    "تمت إضافة مراجعة لبيانات الحسابات توضح المعلومات الناقصة التي قد تؤثر في دقة التقديرات.",
    "تمت إضافة توقع التحصيل والمدفوعات حتى نهاية الشهر، مع فصل المبالغ الفعلية عن المتوقعة. شراء المخزون غير المسجل لا يدخل في التوقع.",
    "تم توحيد المسميات: رسوم الإيواء المتوقعة، والإجمالي المتوقع من الملاك، والمبالغ المحصلة.",
  ] },
  { title: "المخزون", items: [
    "تمت إضافة «يكفي حتى» و«تحتاج توفره في» بحسب كمية الصنف وجدول تغذية الخيل، مع دعم الكيلو والربطة والكسور.",
    "يبقى حساب الاحتياج من اليوم حتى يوم 27، ويظهر موعد توفير الكمية دون الحاجة لتحديد مدة توريد.",
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
