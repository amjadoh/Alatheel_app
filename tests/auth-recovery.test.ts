import { test } from "node:test";
import assert from "node:assert/strict";
import { authFailureAction } from "../src/auth-recovery";
test("temporary network and callable authentication failures do not delete saved credentials", () => {
  for (const code of [
    "auth/network-request-failed",
    "functions/unavailable",
    "functions/deadline-exceeded",
    "functions/unauthenticated",
  ])
    assert.equal(authFailureAction({ code }), "retry");
});
test("disabled, revoked and expired seven-day sessions still require Google sign-in", () => {
  for (const code of [
    "auth/session-expired",
    "auth/user-disabled",
    "auth/user-token-expired",
    "auth/id-token-revoked",
  ])
    assert.equal(authFailureAction({ code }), "sign-out");
});
test("access denial and missing durable storage block access without erasing credentials", () => {
  for (const code of [
    "functions/permission-denied",
    "permission-denied",
    "auth/persistence-unavailable",
  ])
    assert.equal(authFailureAction({ code }), "block");
});
