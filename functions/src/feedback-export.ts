import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { FEEDBACK_REPO } from "./feedback-policy";

export type GithubRequest = (path: string, method?: string, data?: unknown) => Promise<any>;
export class GithubError extends Error {
  constructor(public status: number) { super(`GitHub request failed (${status})`); }
}
export function githubClient(token: string, deadline = Date.now() + 400_000): GithubRequest {
  return async (path, method = "GET", data) => {
    if (!token || Date.now() >= deadline) throw new Error("Export unavailable or deadline exceeded");
    const response = await fetch(`https://api.github.com/repos/${FEEDBACK_REPO}${path}`, {
      method, redirect: "error", signal: AbortSignal.timeout(Math.min(30_000, deadline - Date.now())),
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json",
        "Content-Type": "application/json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "Alatheel-feedback" },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    if (!response.ok) throw new GithubError(response.status);
    return response.json();
  };
}
const escape = (value: unknown) => String(value).replace(/\\/g, "\\\\").replace(/\[/g, "\\[").replace(/\]/g, "\\]").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const hash = (algorithm: string, bytes: Buffer) => createHash(algorithm).update(bytes).digest("hex");

// Keep the same archive paths and issue marker as the original Actions exporter.
export async function exportFeedback(note: any, github: GithubRequest, readFile: (file: any) => Promise<Buffer>) {
  if (!/^[a-zA-Z0-9_-]{6,100}$/.test(note.id)) throw new Error("Invalid feedback id");
  const branch = "app-feedback", marker = `<!-- alatheel-feedback:${note.id} -->`;
  try { await github(`/git/ref/heads/${branch}`); }
  catch (error) {
    if (!(error instanceof GithubError) || error.status !== 404) throw error;
    const source = await github("/git/ref/heads/main");
    await github("/git/refs", "POST", { ref: `refs/heads/${branch}`, sha: source.object.sha });
  }
  async function save(path: string, bytes: Buffer, json = false) {
    const endpoint = `/contents/${path}`;
    try {
      const existing = await github(`${endpoint}?ref=${branch}`);
      const expected = hash("sha1", Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes]));
      if (existing.sha !== expected && !(json && existing.encoding === "base64" &&
        isDeepStrictEqual(JSON.parse(Buffer.from(existing.content, "base64").toString("utf8")), JSON.parse(bytes.toString("utf8"))))) {
        throw new Error("Existing attachment differs");
      }
      return;
    } catch (error) { if (!(error instanceof GithubError) || error.status !== 404) throw error; }
    await github(endpoint, "PUT", { branch, message: "Archive app feedback attachment", content: bytes.toString("base64") });
  }
  const links: string[] = [];
  for (const file of note.files) {
    if (!Number.isSafeInteger(file.index) || file.index < 0 || !/^[a-z0-9]{1,5}$/.test(file.extension)) throw new Error("Invalid attachment");
    const bytes = await readFile(file);
    if (bytes.length !== file.size || hash("sha256", bytes) !== file.sha256) throw new Error("Attachment integrity failed");
    const path = `reports/${note.id}/file_${file.index}.${file.extension}`;
    await save(path, bytes);
    const url = `https://github.com/${FEEDBACK_REPO}/blob/${branch}/${path}`;
    links.push(`- [${escape(file.name)}](${url})`);
    if (["jpg", "jpeg", "png", "webp", "gif"].includes(file.extension)) links.push(`\n![${escape(file.name)}](${url}?raw=true)\n`);
  }
  // Python used ensure_ascii=False, indent=2 with this exact field order.
  const archive = { id: note.id, text: note.text, files: note.files, version: note.version, createdByName: note.createdByName, createdAt: note.createdAt };
  await save(`reports/${note.id}/note.json`, Buffer.from(JSON.stringify(archive, null, 2)), true);
  for (let page = 1; page <= 20; page++) {
    const rows = await github(`/issues?state=all&sort=created&direction=desc&per_page=100&page=${page}`);
    const existing = rows.find((row: any) => !row.pull_request && String(row.body || "").startsWith(marker + "\n"));
    if (existing) return existing;
    if (rows.length < 100) {
      return github("/issues", "POST", {
        title: `ملاحظة التطبيق · ${String(note.text || "مرفقات من المدير").split("\n")[0].slice(0,85)}`,
        body: `${marker}\n\n${escape(note.text || "مرفقات فقط")}\n\n---\nالمدير: ${escape(note.createdByName)}\n\nالإصدار: ${escape(note.version)}\n\nالتاريخ: ${escape(note.createdAt)}\n\n${links.join("\n")}`,
      });
    }
  }
  throw new Error("Issue history exceeds safe reconciliation limit");
}
