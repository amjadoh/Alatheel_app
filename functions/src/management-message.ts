import { PRIMARY_ADMIN_EMAIL, normalizeEmail } from "./access";
import { ensure } from "./domain";

const recipientId = /^[A-Za-z0-9_-]{1,128}$/;
const requestId = /^[A-Za-z0-9_-]{6,100}$/;

export function validateManagementMessage(data: any, senderEmail?: string) {
  ensure(
    !!senderEmail && normalizeEmail(senderEmail) === PRIMARY_ADMIN_EMAIL,
    "إرسال رسائل الإدارة متاح للمدير الأساسي فقط",
  );
  const body = String(data?.body || "").trim();
  ensure(body.length > 0 && body.length <= 500, "نص الإشعار يجب أن يكون من 1 إلى 500 حرف");
  ensure(requestId.test(String(data?.requestId || "")), "معرف الإرسال غير صالح");
  ensure(
    Array.isArray(data?.recipientIds) &&
      data.recipientIds.length > 0 &&
      data.recipientIds.length <= 100 &&
      data.recipientIds.every((id: unknown) =>
        recipientId.test(String(id || "")),
      ),
    "اختر من 1 إلى 100 مستلم صالح",
  );
  return {
    body,
    requestId: String(data.requestId),
    recipientIds: [...new Set(data.recipientIds as string[])],
  };
}
