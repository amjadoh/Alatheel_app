import { test } from "node:test";
import assert from "node:assert/strict";
import { retainRequiredUpdate } from "../src/update-check-policy";
test("known mandatory release cannot be unlocked by a stale no-update response", () => {
  const known = { available: true, versionName: "1.9.1", ready: true };
  assert.equal(retainRequiredUpdate(known, { available: false, versionName: "1.9.0", ready: false }), known);
  const incoming = { available: true, versionName: "1.9.2", ready: false };
  assert.equal(retainRequiredUpdate(known, incoming), incoming);
  assert.equal(retainRequiredUpdate(null, incoming), incoming);
});
