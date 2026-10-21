// Milestones represent completed work, not an estimate of time remaining.
export function startupProgress(input: {
  sessionResolved: boolean;
  authorized: boolean;
  verifiedVersion: boolean;
  dataReady: boolean;
  received?: number;
  expected?: number;
}) {
  const loaded = input.expected && input.expected > 0
    ? Math.max(0, Math.min(1, (input.received || 0) / input.expected))
    : 0;
  return 10 + (input.sessionResolved ? 15 : 0)
    + (input.authorized ? 20 : 0)
    + (input.verifiedVersion ? 20 : 0)
    + (input.dataReady ? 35 : loaded * 25);
}
