import { test } from "node:test";
import assert from "node:assert/strict";
import {
  retainRequiredUpdate,
  shouldCheckUpdate,
  UPDATE_RESUME_TTL_MS,
} from "../src/update-check-policy";

test("cold startup always verifies Official", () => {
  assert.equal(shouldCheckUpdate("startup", null, 1000), true);
  assert.equal(shouldCheckUpdate("startup", 999, 1000), true);
});
test("brief resume reuses verification but refreshes Official at five minutes", () => {
  assert.equal(shouldCheckUpdate("resume", null, 1000), true);
  assert.equal(shouldCheckUpdate("resume", 0, 0), false);
  assert.equal(
    shouldCheckUpdate("resume", 1000, 1000 + UPDATE_RESUME_TTL_MS - 1),
    false,
  );
  assert.equal(
    shouldCheckUpdate("resume", 1000, 1000 + UPDATE_RESUME_TTL_MS),
    true,
  );
  assert.equal(shouldCheckUpdate("resume", 1000, 999), true);
});
test("manual checks ignore the resume cache", () => {
  assert.equal(shouldCheckUpdate("manual", 999, 1000), true);
});
test("failed verification forces resume to retry", () => {
  assert.equal(shouldCheckUpdate("resume", 999, 1000, true), true);
});

test("known mandatory release cannot be unlocked by a stale no-update response", () => {
  const known = { available: true, versionName: "1.9.1", ready: true };
  assert.equal(
    retainRequiredUpdate(known, {
      available: false,
      versionName: "1.9.0",
      ready: false,
    }),
    known,
  );
  const incoming = { available: true, versionName: "1.9.2", ready: false };
  assert.equal(retainRequiredUpdate(known, incoming), incoming);
  assert.equal(retainRequiredUpdate(null, incoming), incoming);
});
