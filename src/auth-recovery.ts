export type AuthPhase =
  "restoring" | "ready" | "signed-out" | "waiting" | "blocked";

// A failed callable request alone is not evidence that saved credentials were
// revoked. Let the SDK refresh its token and retry without deleting the session.
export function authFailureAction(
  error: unknown,
): "sign-out" | "block" | "retry" {
  const code = String((error as { code?: string })?.code || "");
  if (
    [
      "auth/session-expired",
      "auth/user-disabled",
      "auth/user-token-expired",
      "auth/id-token-revoked",
    ].includes(code)
  )
    return "sign-out";
  if (
    [
      "functions/permission-denied",
      "permission-denied",
      "auth/persistence-unavailable",
    ].includes(code)
  )
    return "block";
  return "retry";
}
