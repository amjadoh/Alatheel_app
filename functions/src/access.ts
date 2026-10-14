export const PRIMARY_ADMIN_EMAIL = "amjadoh@gmail.com";
export const normalizeEmail = (email: string) => email.trim().toLowerCase();
export type GoogleIdentity = {
  email?: string;
  emailVerified: boolean;
  signInProvider?: string;
  disabled?: boolean;
};
export function requireGoogle(identity: GoogleIdentity) {
  if (identity.disabled) throw new Error("الحساب معطل");
  if (
    identity.signInProvider !== "google.com" ||
    !identity.emailVerified ||
    !identity.email
  )
    throw new Error("يجب تسجيل الدخول بحساب Google موثّق فقط");
}
export function resolveAccess(
  identity: GoogleIdentity,
  profile?: Record<string, any>,
) {
  requireGoogle(identity);
  if (profile?.disabled || profile?.deleted)
    throw new Error("الحساب معطل أو محذوف");
  const email = normalizeEmail(identity.email!);
  if (profile && normalizeEmail(profile.email || "") !== email)
    throw new Error("البريد لا يطابق العضوية المسجلة");
  if (email === PRIMARY_ADMIN_EMAIL) return "admin";
  if (!profile || profile.membershipApproved !== true)
    throw new Error(
      "هذا البريد غير مسجل لدى الإسطبل. اطلب من المدير إضافته أولًا",
    );
  if (!["admin", "employee", "owner", "viewer"].includes(profile.role))
    throw new Error("صلاحية العضوية غير صالحة");
  return profile.role as string;
}
