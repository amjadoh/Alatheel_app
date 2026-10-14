import { test } from "node:test";
import assert from "node:assert/strict";
import { invitationMessage } from "../functions/src/invitations";
const url =
  "https://alatheel-app-426403695200.web.app/downloads/Alatheel-latest.apk";
test("invitation includes the stable latest APK URL and exact Google account", () => {
  const m = invitationMessage("عضو", "member@gmail.com", url);
  assert.ok(m.text.includes(url));
  assert.ok(m.html.includes(url));
  assert.ok(m.text.includes("member@gmail.com"));
  assert.ok(m.text.includes("Google"));
});
test("invitation escapes names and rejects unsafe download URLs", () => {
  assert.ok(
    !invitationMessage('<script>"', "member@gmail.com", url).html.includes(
      "<script>",
    ),
  );
  for (const link of [
    "http://example.com/a.apk",
    "javascript:alert(1)",
    "https://user:password@example.com/a.apk",
  ])
    assert.throws(() => invitationMessage("عضو", "member@gmail.com", link));
});
