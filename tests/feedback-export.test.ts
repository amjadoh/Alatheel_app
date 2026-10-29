import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { exportFeedback, GithubError } from "../functions/src/feedback-export";

function fixture() {
  const bytes = Buffer.from("مرفق اختباري $(never-execute)");
  const note = { id: "isolated_note", text: "ملاحظة <script> [link]", version: "1.12.3", createdByName: "مدير", createdAt: "2026-10-29T00:00:00Z",
    files: [{ index: 0, name: "فحص.txt", extension: "txt", size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") }] };
  const files = new Map<string, Buffer>(), issues: any[] = [];
  const github = async (path: string, method = "GET", data?: any): Promise<any> => {
    if (path.startsWith("/git/ref/")) return { object: { sha: "base" } };
    if (path.startsWith("/contents/")) {
      const key = path.split("?")[0];
      if (method === "PUT") {
        assert.equal(data.branch, "app-feedback"); assert.equal(files.has(key), false);
        files.set(key, Buffer.from(data.content, "base64")); return {};
      }
      const content = files.get(key);
      if (!content) throw new GithubError(404);
      return { sha: createHash("sha1").update(Buffer.concat([Buffer.from(`blob ${content.length}\0`), content])).digest("hex"), encoding: "base64", content: content.toString("base64") };
    }
    if (path.startsWith("/issues?")) return issues;
    if (path === "/issues" && method === "POST") {
      const issue = { ...data, number: 1, html_url: "https://github.com/amjadoh/Alatheel_app/issues/1" };
      issues.push(issue); return issue;
    }
    throw new Error(`Unexpected request ${path}`);
  };
  return { bytes, note, files, issues, github };
}
test("retries reuse exact attachments and one issue", async () => {
  const f = fixture();
  await exportFeedback(f.note, f.github, async () => f.bytes);
  await exportFeedback(f.note, f.github, async () => f.bytes);
  assert.equal(f.files.size, 2); assert.equal(f.issues.length, 1);
  assert.match(f.issues[0].body, /&lt;script&gt;/);
  assert.match(f.issues[0].body, /app-feedback\/reports\/isolated_note\/file_0.txt/);
});
test("ambiguous issue creation is reconciled before retrying POST", async () => {
  const f = fixture(); let first = true;
  const ambiguous = async (path: string, method?: string, data?: unknown) => {
    const result = await f.github(path, method, data);
    if (path === "/issues" && first) { first = false; throw new Error("connection lost after write"); }
    return result;
  };
  await assert.rejects(exportFeedback(f.note, ambiguous, async () => f.bytes));
  await exportFeedback(f.note, ambiguous, async () => f.bytes);
  assert.equal(f.issues.length, 1);
});
test("corrupt attachments and conflicting existing files are never overwritten", async () => {
  const f = fixture();
  await assert.rejects(exportFeedback(f.note, f.github, async () => Buffer.from("wrong")), /integrity/);
  assert.equal(f.files.size, 0);
  f.files.set("/contents/reports/isolated_note/file_0.txt", Buffer.from("existing"));
  await assert.rejects(exportFeedback(f.note, f.github, async () => f.bytes), /differs/);
  assert.equal(f.issues.length, 0);
});
test("legacy note JSON with different field order is accepted without overwriting", async () => {
  const f = fixture();
  const archive = Object.fromEntries(Object.entries(f.note).reverse());
  f.files.set("/contents/reports/isolated_note/note.json", Buffer.from(JSON.stringify(archive)));
  await exportFeedback(f.note, f.github, async () => f.bytes);
  assert.equal(f.issues.length, 1);
  assert.equal(f.files.get("/contents/reports/isolated_note/note.json")!.toString(), JSON.stringify(archive));
});
test("authorization failures do not create branches or issues", async () => {
  const f = fixture(); let calls = 0;
  await assert.rejects(exportFeedback(f.note, async () => { calls++; throw new GithubError(403); }, async () => f.bytes));
  assert.equal(calls, 1);
});
