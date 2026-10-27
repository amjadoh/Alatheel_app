import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_UPDATE_CHANNEL,
  readUpdateChannel,
  UPDATE_CHANNEL_KEY,
  updateChannelForAccess,
  writeUpdateChannel,
} from "../src/update-channel";

test("stable is the default channel when no valid preference exists", () => {
  assert.equal(DEFAULT_UPDATE_CHANNEL, "stable");
  assert.equal(readUpdateChannel(null), "stable");
  assert.equal(readUpdateChannel({ getItem: () => null }), "stable");
  assert.equal(readUpdateChannel({ getItem: () => "preview" }), "stable");
});

test("beta preference is stored and restored explicitly", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
  writeUpdateChannel(storage, "beta");
  assert.equal(values.get(UPDATE_CHANNEL_KEY), "beta");
  assert.equal(readUpdateChannel(storage), "beta");
});

test("beta is available only to the primary admin", () => {
  assert.equal(updateChannelForAccess(true, "beta"), "beta");
  assert.equal(updateChannelForAccess(false, "beta"), "stable");
  assert.equal(updateChannelForAccess(false, "stable"), "stable");
});

test("storage errors fall back to stable without blocking startup", () => {
  assert.equal(
    readUpdateChannel({
      getItem: () => {
        throw new Error("blocked");
      },
    }),
    "stable",
  );
  assert.doesNotThrow(() =>
    writeUpdateChannel(
      {
        setItem: () => {
          throw new Error("full");
        },
      },
      "beta",
    ),
  );
});
