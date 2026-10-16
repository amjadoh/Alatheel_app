import { test } from "node:test";
import assert from "node:assert/strict";
import {
  needsReleaseNotes,
  markReleaseNotesRead,
  RELEASE_VERSION,
} from "../src/release-notes";
test("release notes remain eligible until closed, then the installed version stays acknowledged", () => {
  const data = new Map<string, string>(),
    store = {
      getItem: (k: string) => data.get(k) || null,
      setItem: (k: string, v: string) => {
        data.set(k, v);
      },
    };
  assert.equal(needsReleaseNotes(store), true);
  assert.equal(needsReleaseNotes(store), true);
  markReleaseNotesRead(store);
  assert.equal(needsReleaseNotes(store), false);
  assert.equal(data.get("alatheel.release.read." + RELEASE_VERSION), "yes");
});
