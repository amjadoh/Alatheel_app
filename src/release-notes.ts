export const RELEASE_VERSION = "1.7.0";
export const RELEASE_NOTES = [
  {
    title: "حسابك · أعلى اليسار",
    items: ["تم إضافة صورتك واسمك؛ بالضغط عليهما تظهر قائمة المزيد."],
  },
  {
    title: "الصفحة الرئيسية",
    items: [
      "تم توضيح التحصيل الفعلي والمبالغ المدفوعة للمخزون والرواتب والمصروفات الأخرى، مع فصل الفرق بين التحصيل والمدفوعات عن عجز التشغيل المقدّر.",
      "تم حفظ أسعار وحسابات كل شهر بعد إغلاقه؛ التعديلات اللاحقة لا تغيّر الأشهر المغلقة.",
    ],
  },
  {
    title: "الخيل",
    items: [
      "تم إضافة خيار احتساب الإيواء بالشهر أو بالأيام الفعلية.",
      "الخيل الملك الخاص يعرض تكلفته دون متبقٍ على المالك أو خيارات تحصيل.",
    ],
  },
  {
    title: "المخزون",
    items: [
      "«تسجيل صنف» لتعريف العلف، و«شراء وإضافة» لزيادة كميته وتسجيل المبلغ المدفوع مرة واحدة على الصنف نفسه.",
      "تصحيح كمية المخزون لا يسجل مصروف شراء.",
    ],
  },
  {
    title: "التحصيل",
    items: [
      "هنا تسجل ما تستلمه من المالك، سواء للإيواء أو لمصروف اخترت «يُسترد من المالك».",
      "تم فصل كشف الحساب إلى متأخرات، ومستحق حتى اليوم، ومبالغ تستحق لاحقًا هذا الشهر.",
    ],
  },
  {
    title: "المصروفات",
    items: [
      "تم إضافة المصروفات إلى الشريط السفلي للوصول إليها مباشرة.",
      "هنا تسجل ما تدفعه أنت للطبيب أو غيره. يبقى المصروف غير المدفوع مستحقًا حتى تسجل سداده؛ تحصيل قيمته من المالك لا يعني أنك سددته.",
      "مصروفات الإسطبل، مثل راتب العامل، تدخل في التكلفة ولا تُضاف تلقائيًا على المالك.",
    ],
  },
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
