import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveAccess, requireGoogle } from "../functions/src/access";
const google = {
  email: "member@gmail.com",
  emailVerified: true,
  signInProvider: "google.com",
};
test("Google login alone does not admit an unlisted email", () =>
  assert.throws(() => resolveAccess(google), /غير مسجل/));
test("administrator-added member retains the assigned role", () =>
  assert.equal(
    resolveAccess(google, {
      email: google.email,
      role: "owner",
      disabled: false,
      membershipApproved: true,
    }),
    "owner",
  ));
test("legacy self-created profiles do not bypass administrator approval", () =>
  assert.throws(
    () => resolveAccess(google, { email: google.email, role: "admin" }),
    /غير مسجل/,
  ));
test("a second approved administrator can log in", () =>
  assert.equal(
    resolveAccess(google, {
      email: google.email,
      role: "admin",
      membershipApproved: true,
    }),
    "admin",
  ));
test("only the verified Google identity for the primary email bootstraps admin", () =>
  assert.equal(
    resolveAccess({ ...google, email: " Amjadoh@Gmail.com " }),
    "admin",
  ));
test("password, custom, anonymous and missing providers are rejected even for admin", () => {
  for (const signInProvider of ["password", "custom", "anonymous", undefined])
    assert.throws(
      () =>
        resolveAccess({
          ...google,
          email: "amjadoh@gmail.com",
          signInProvider,
        }),
      /Google/,
    );
});
test("unverified email cannot enter or bootstrap admin", () =>
  assert.throws(
    () =>
      resolveAccess({
        ...google,
        email: "amjadoh@gmail.com",
        emailVerified: false,
      }),
    /Google/,
  ));
test("disabled and deleted memberships cannot enter", () => {
  for (const profile of [{ disabled: true }, { deleted: true }])
    assert.throws(
      () =>
        resolveAccess(google, {
          email: google.email,
          role: "owner",
          ...profile,
        }),
      /معطل/,
    );
  assert.throws(() => requireGoogle({ ...google, disabled: true }), /معطل/);
});
test("a Google identity cannot take another email membership", () =>
  assert.throws(
    () => resolveAccess(google, { email: "other@gmail.com", role: "admin" }),
    /لا يطابق/,
  ));
test("stored primary admin role is restored only after verified Google login", () =>
  assert.equal(
    resolveAccess(
      { ...google, email: "amjadoh@gmail.com" },
      { email: "amjadoh@gmail.com", role: "viewer" },
    ),
    "admin",
  ));
