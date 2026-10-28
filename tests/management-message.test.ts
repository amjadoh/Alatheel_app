import { test } from "node:test";
import assert from "node:assert/strict";
import { validateManagementMessage } from "../functions/src/management-message";

const primary = "amjadoh@gmail.com";

test("primary manager messages trim text and deduplicate selected recipients", () => {
  assert.deepEqual(
    validateManagementMessage(
      { body: "  تنبيه تجريبي  ", requestId: "request_123", recipientIds: ["user_1", "user_1", "user_2"] },
      primary,
    ),
    { body: "تنبيه تجريبي", requestId: "request_123", recipientIds: ["user_1", "user_2"] },
  );
});

test("management message authorization and input limits are enforced", () => {
  const valid = { body: "تنبيه", requestId: "request_123", recipientIds: ["user_1"] };
  assert.throws(() => validateManagementMessage(valid, "other@example.test"), /متاح/);
  assert.throws(() => validateManagementMessage({ ...valid, body: " " }, primary), /1 إلى 500/);
  assert.throws(() => validateManagementMessage({ ...valid, body: "x".repeat(501) }, primary), /1 إلى 500/);
  assert.throws(() => validateManagementMessage({ ...valid, requestId: "bad" }, primary), /معرف الإرسال/);
  assert.throws(() => validateManagementMessage({ ...valid, recipientIds: [] }, primary), /مستلم/);
  assert.throws(() => validateManagementMessage({ ...valid, recipientIds: ["../other"] }, primary), /مستلم/);
});
