// Once this installed app has observed a required update, a stale manifest must
// not unlock it. Installing the update starts a new process and a fresh check.
export function retainRequiredUpdate<T extends { available: boolean }>(
  known: T | null,
  incoming: T,
): T {
  return known?.available && !incoming.available ? known : incoming;
}
