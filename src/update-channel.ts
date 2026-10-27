export const UPDATE_CHANNEL_KEY = "alatheel.update-channel";
export const UPDATE_CHANNELS = ["stable", "beta"] as const;

export type UpdateChannel = (typeof UPDATE_CHANNELS)[number];

export const DEFAULT_UPDATE_CHANNEL: UpdateChannel = "stable";

export function updateChannelForAccess(
  primaryAdmin: boolean,
  channel: UpdateChannel,
): UpdateChannel {
  return primaryAdmin ? channel : DEFAULT_UPDATE_CHANNEL;
}

export function isUpdateChannel(value: unknown): value is UpdateChannel {
  return value === "stable" || value === "beta";
}

export function readUpdateChannel(
  storage: Pick<Storage, "getItem"> | null | undefined,
): UpdateChannel {
  if (!storage) return DEFAULT_UPDATE_CHANNEL;
  try {
    const value = storage.getItem(UPDATE_CHANNEL_KEY);
    return isUpdateChannel(value) ? value : DEFAULT_UPDATE_CHANNEL;
  } catch {
    return DEFAULT_UPDATE_CHANNEL;
  }
}

export function writeUpdateChannel(
  storage: Pick<Storage, "setItem"> | null | undefined,
  channel: UpdateChannel,
): void {
  if (!storage) return;
  try {
    storage.setItem(UPDATE_CHANNEL_KEY, channel);
  } catch {
    // A storage failure must not prevent the default stable update check.
  }
}
