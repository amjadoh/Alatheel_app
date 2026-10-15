import { test } from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error Release packaging script is deliberately plain Node.js.
import { updateManifest } from "../scripts/update-manifest.mjs";

test("update manifest binds the immutable release URL, byte count, and checksum", () => {
  const m = updateManifest(Buffer.from("abc"), "1.4.0", 5, "notes");
  assert.equal(m.packageId, "com.alatheel.stable");
  assert.equal(m.versionCode, 5);
  assert.equal(
    m.url,
    "https://alatheel-app-426403695200.web.app/downloads/Alatheel-1.4.0.apk",
  );
  assert.equal(m.size, 3);
  assert.equal(
    m.sha256,
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
});
test("manifest generation refuses invalid version, version code and empty APK", () => {
  assert.throws(() => updateManifest(Buffer.from("abc"), "../latest", 5, ""));
  assert.throws(() => updateManifest(Buffer.from("abc"), "1.4.0", -1, ""));
  assert.throws(() => updateManifest(Buffer.from("abc"), "1.4.0", 5.5, ""));
  assert.throws(() => updateManifest(Buffer.alloc(0), "1.4.0", 5, ""));
});
