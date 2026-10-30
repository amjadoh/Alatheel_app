import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from 'node:fs';
import {
  needsReleaseNotes,
  markReleaseNotesRead,
  RELEASE_VERSION,
  RELEASE_VERSION_CODE,
} from "../src/release-notes";
test('client compatibility metadata matches the signed Android version',()=>{
  const gradle=readFileSync(new URL('../android/app/build.gradle',import.meta.url),'utf8');
  assert.equal(RELEASE_VERSION_CODE,Number(gradle.match(/versionCode (\d+)/)![1]));
  assert.equal(RELEASE_VERSION,gradle.match(/versionName "([^"]+)"/)![1]);
});
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
