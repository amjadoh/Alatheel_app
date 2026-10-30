// Manual, approved publication only. Never run automatically after a build.
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";

const host = "https://alatheel-app-426403695200.web.app";
const project = "gen-lang-client-0145196991",
  site = "alatheel-app-426403695200";
const database = "ai-studio-3316cd3a-14d1-4f71-adec-897324c5bb0e";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
export function releasePaths(manifest) {
  assert.ok(
    ["stable", "beta"].includes(manifest.channel),
    "Invalid update channel",
  );
  assert.equal(manifest.packageId, "com.alatheel.stable");
  assert.match(manifest.versionName, /^\d+\.\d+\.\d+$/);
  assert.ok(
    Number.isSafeInteger(manifest.versionCode) && manifest.versionCode >= 10,
  );
  assert.ok(
    Number.isSafeInteger(manifest.size) &&
      manifest.size > 0 &&
      manifest.size <= 100 * 1024 * 1024,
  );
  assert.match(manifest.sha256, /^[a-f0-9]{64}$/);
  const lane = manifest.channel === "beta" ? "beta/" : "";
  const apk = `/downloads/${lane}Alatheel-${manifest.versionName}.apk`;
  assert.equal(manifest.url, host + apk);
  return {
    manifest: `/${lane}latest.json`,
    apk,
    latest: `/downloads/${lane}Alatheel-latest.apk`,
  };
}
export async function verifyPublished(expected, fetcher = fetch) {
  const paths = releasePaths(expected);
  async function bytes(path, max) {
    const response = await fetcher(host + path, {
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(60000),
    });
    assert.equal(response.status, 200, `Unavailable release file: ${path}`);
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      assert.ok(size <= max, "Release file exceeds expected size");
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }
  const manifest = JSON.parse(
    (await bytes(paths.manifest, 12000)).toString("utf8"),
  );
  for (const key of [
    "channel",
    "packageId",
    "versionName",
    "versionCode",
    "url",
    "size",
    "sha256",
    "notes",
  ])
    assert.equal(manifest[key], expected[key], `Published ${key} mismatch`);
  for (const path of [paths.apk, paths.latest]) {
    const value = await bytes(path, expected.size);
    assert.equal(value.length, expected.size);
    assert.equal(hash(value), expected.sha256, `APK hash mismatch: ${path}`);
  }
}
export function announcementMatches(value, expected) {
  return (
    value?.channel === expected.channel &&
    value?.versionCode === expected.versionCode &&
    value?.versionName === expected.versionName &&
    value?.sha256 === expected.sha256
  );
}
export async function publishAndAnnounce(
  expected,
  operations,
  { announceOnly = false, attempts = 24 } = {},
) {
  releasePaths(expected);
  if (!announceOnly) await operations.deploy();
  await operations.verify(expected);
  if (announcementMatches(await operations.readAnnouncement(), expected))
    return { alreadyAnnounced: true };
  await operations.requestAnnouncement();
  for (let i = 0; i < attempts; i++) {
    await operations.wait();
    if (announcementMatches(await operations.readAnnouncement(), expected))
      return { announced: true };
  }
  throw Error(
    "Release is published, but its announcement is not confirmed; retry --announce-only. Do not claim notification delivery.",
  );
}

async function main() {
  const channel = process.argv[2];
  assert.ok(
    ["stable", "beta"].includes(channel),
    "Usage: node scripts/publish-update.mjs stable|beta [--announce-only]",
  );
  assert.ok(
    process.argv.slice(3).every((x) => x === "--announce-only"),
    "Unknown argument",
  );
  const root = resolve(fileURLToPath(new URL("..", import.meta.url))),
    publicDir = join(root, "downloads-hosting");
  const expected = JSON.parse(
    await readFile(
      join(publicDir, channel === "beta" ? "beta/latest.json" : "latest.json"),
      "utf8",
    ),
  );
  assert.equal(expected.channel, channel);
  const paths = releasePaths(expected);
  for (const p of [paths.apk, paths.latest]) {
    const bytes = await readFile(join(publicDir, p.slice(1)));
    assert.equal(bytes.length, expected.size);
    assert.equal(hash(bytes), expected.sha256);
  }
  const config = JSON.parse(
    await readFile(join(root, "firebase.json"), "utf8"),
  );
  assert.equal(config.hosting.site, site);
  assert.equal(config.hosting.public, "downloads-hosting");
  const cli = process.env.FIREBASE_TOOLS_ROOT
    ? resolve(process.env.FIREBASE_TOOLS_ROOT)
    : join(root, ".release/firebase-cli/node_modules/firebase-tools");
  const require = createRequire(import.meta.url),
    auth = require(join(cli, "lib/auth")),
    { requireAuth } = require(join(cli, "lib/requireAuth")),
    { Client } = require(join(cli, "lib/apiv2"));
  const options = { project, nonInteractive: true };
  auth.setActiveAccount(options, auth.getGlobalDefaultAccount());
  await requireAuth(options);
  const firestore = new Client({
      urlPrefix: "https://firestore.googleapis.com",
      apiVersion: "v1",
    }),
    scheduler = new Client({
      urlPrefix: "https://cloudscheduler.googleapis.com",
      apiVersion: "v1",
    });
  const ref = `/projects/${project}/databases/${database}/documents/appUpdateState/${channel === "beta" ? "beta" : "current"}`;
  async function preserveHosting() {
    const api = new Client({
      urlPrefix: "https://firebasehosting.googleapis.com",
      apiVersion: "v1beta1",
    });
    const releases = (
      await api.get(`/sites/${site}/releases`, {
        queryParams: { pageSize: 1 },
        skipLog: { resBody: true },
      })
    ).body;
    assert.ok(
      releases.releases?.[0]?.version?.name,
      "Cannot verify existing Hosting files",
    );
    let pageToken;
    do {
      const page = (
        await api.get("/" + releases.releases[0].version.name + "/files", {
          queryParams: { pageSize: 1000, ...(pageToken ? { pageToken } : {}) },
          skipLog: { resBody: true },
        })
      ).body;
      for (const f of page.files || []) {
        if (
          f.path.startsWith("/__/") ||
          [paths.manifest, paths.latest].includes(f.path)
        )
          continue;
        assert.ok(!f.path.includes(".."));
        const bytes = await readFile(
          join(publicDir, f.path.replace(/^\//, "")),
        );
        assert.equal(
          hash(gzipSync(bytes, { level: 9 })),
          f.hash,
          `Preserve existing Hosting file: ${f.path}`,
        );
      }
      pageToken = page.nextPageToken;
    } while (pageToken);
  }
  const result = await publishAndAnnounce(
    expected,
    {
      deploy: async () => {
        await preserveHosting();
        await new Promise((done, reject) => {
          const child = spawn(
            process.execPath,
            [
              join(cli, "lib/bin/firebase.js"),
              "deploy",
              "--only",
              "hosting",
              "--project",
              project,
              "--non-interactive",
            ],
            {
              cwd: root,
              env: process.env,
              stdio: "inherit",
              windowsHide: true,
            },
          );
          child.on("error", reject);
          child.on("exit", (code) =>
            code === 0 ? done() : reject(Error("Hosting deploy failed")),
          );
        });
      },
      verify: verifyPublished,
      readAnnouncement: async () => {
        try {
          const r = (await firestore.get(ref, { skipLog: { resBody: true } }))
            .body;
          return Object.fromEntries(
            Object.entries(r.fields || {}).map(([k, v]) => [
              k,
              "integerValue" in v ? Number(v.integerValue) : v.stringValue,
            ]),
          );
        } catch (e) {
          if (e.status === 404 || e.context?.response?.statusCode === 404)
            return null;
          throw e;
        }
      },
      requestAnnouncement: async () => {
        await scheduler.post(
          `/projects/${project}/locations/us-central1/jobs/firebase-schedule-discoverAppUpdates-us-central1:run`,
          {},
          { skipLog: { resBody: true } },
        );
      },
      wait: () => new Promise((done) => setTimeout(done, 5000)),
    },
    { announceOnly: process.argv.includes("--announce-only") },
  );
  console.log(
    JSON.stringify({
      channel,
      version: expected.versionName,
      ...result,
      deviceNotificationDisplay: "not verified",
    }),
  );
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main().catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
