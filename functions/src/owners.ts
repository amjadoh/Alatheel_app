import { ensure, Row } from "./domain";
import { normalizeEmail } from "./access";

/** An administrator explicitly links a login to one existing business owner. */
export function assertOwnerLink(
  owner: Row | undefined,
  uid: string,
  email: string,
  currentOwnerId?: string,
) {
  ensure(owner, "سجل المالك غير موجود");
  ensure(
    !owner.linkedUserId || owner.linkedUserId === uid,
    "المالك مرتبط بحساب آخر",
  );
  ensure(
    !currentOwnerId || currentOwnerId === owner.id,
    "الحساب مرتبط بمالك آخر؛ لا يمكن نقل ملكية السجلات بتعديل العضوية",
  );
  ensure(
    !owner.email || normalizeEmail(owner.email) === normalizeEmail(email),
    "بريد الحساب لا يطابق بريد المالك؛ صحح بيانات المالك أولًا",
  );
}

export function invitationRequested(data: Record<string, any>) {
  return data.sendInvitation === true || data.sendInvitation === "yes";
}
