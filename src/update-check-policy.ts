// A successful check is reused only while this running process briefly resumes.
// Nothing is persisted: a fresh process must verify the published release again.
export const UPDATE_RESUME_TTL_MS = 5 * 60 * 1000;
export type UpdateCheckReason = "startup" | "resume" | "manual";

export function shouldCheckUpdate(
  reason: UpdateCheckReason,
  lastSuccessAt: number | null,
  now: number,
  previousCheckFailed = false,
) {
  if (reason !== "resume" || previousCheckFailed || lastSuccessAt === null)
    return true;
  const elapsed = now - lastSuccessAt;
  return elapsed < 0 || elapsed >= UPDATE_RESUME_TTL_MS;
}

// Once this installed app has observed a required update, a stale manifest must
// not unlock it. Installing the update starts a new process and a fresh check.
export function retainRequiredUpdate<T extends { available: boolean }>(
  known: T | null,
  incoming: T,
): T {
  return known?.available && !incoming.available ? known : incoming;
}
