export const SESSION_DAYS = 7;
export const SESSION_SECONDS = SESSION_DAYS * 24 * 60 * 60;
export function sessionExpiresAt(authTime: unknown) {
  const seconds = Number(authTime);
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error("تعذر التحقق من جلسة الدخول؛ سجل الدخول مجددًا");
  return (seconds + SESSION_SECONDS) * 1000;
}
export function assertSession(authTime: unknown, now = Date.now()) {
  if (now >= sessionExpiresAt(authTime)) throw new Error("انتهت مدة الدخول البالغة 7 أيام؛ سجل الدخول عبر Google مجددًا");
}
