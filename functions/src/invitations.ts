/** Only fixed diagnostic categories leave the SMTP boundary; never log response text or credentials. */
export function invitationFailureCode(
  error: unknown,
  stage: "download" | "smtp",
) {
  if (stage === "download") return "download_unavailable";
  const code = (error as { code?: string } | null)?.code;
  if (code === "EAUTH") return "mail_authentication";
  if (
    [
      "ETIMEDOUT",
      "ESOCKET",
      "ECONNECTION",
      "ECONNRESET",
      "ECONNREFUSED",
      "EDNS",
      "EHOSTUNREACH",
    ].includes(code || "")
  )
    return "mail_connection";
  if (code === "EENVELOPE") return "mail_address";
  return "mail_delivery";
}

export function invitationMessage(
  name: string,
  email: string,
  downloadUrl: string,
) {
  const url = new URL(downloadUrl);
  if (url.protocol !== "https:" || url.username || url.password)
    throw new Error("رابط التحميل يجب أن يكون HTTPS");
  const escape = (s: string) =>
    s.replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c]!,
    );
  return {
    subject: "دعوة للانضمام إلى إسطبل الأثيل",
    text: `مرحبًا ${name}،\nأضافك مدير إسطبل الأثيل إلى التطبيق.\nحمّل أحدث إصدار لأندرويد من هذا الرابط:\n${url.href}\nثم اختر تسجيل الدخول باستخدام Google واستخدم حساب ${email}.\nالدعوة لا تغيّر الصلاحية التي حددها المدير.`,
    html: `<div dir="rtl" lang="ar"><h2>دعوة إلى إسطبل الأثيل</h2><p>مرحبًا ${escape(name)}، أضافك مدير الإسطبل إلى التطبيق.</p><p><a href="${escape(url.href)}">تحميل أحدث إصدار لأندرويد</a></p><p>بعد التثبيت اختر الدخول باستخدام Google بالحساب <b>${escape(email)}</b>.</p><p>الدعوة لا تغيّر الصلاحية التي حددها المدير.</p></div>`,
  };
}
