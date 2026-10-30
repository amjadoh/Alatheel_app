import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
// @ts-expect-error release tooling is intentionally plain Node ESM
import * as publication from "../scripts/publish-update.mjs";
const { releasePaths, verifyPublished, publishAndAnnounce } = publication;
const bytes = Buffer.from("isolated signed-candidate substitute");
const manifest = {
  channel: "stable",
  packageId: "com.alatheel.stable",
  versionName: "1.13.0",
  versionCode: 22,
  size: bytes.length,
  sha256: createHash("sha256").update(bytes).digest("hex"),
  url: "https://alatheel-app-426403695200.web.app/downloads/Alatheel-1.13.0.apk",
  notes: "تم معالجة وتحسين بعض الإجراءات",
};
test("release verification checks manifest and both APK URLs before announcement", async () => {
  const urls: string[] = [];
  await verifyPublished(manifest, async (url: string) => {
    urls.push(url);
    return new Response(
      url.endsWith(".json") ? JSON.stringify(manifest) : bytes,
    );
  });
  assert.equal(urls.length, 3);
  await assert.rejects(
    verifyPublished(
      manifest,
      async (url: string) =>
        new Response(
          url.endsWith(".json")
            ? JSON.stringify({ ...manifest, versionCode: 21 })
            : bytes,
        ),
    ),
  );
  await assert.rejects(
    verifyPublished(
      manifest,
      async (url: string) =>
        new Response(
          url.endsWith(".json")
            ? JSON.stringify(manifest)
            : Buffer.from("corrupt"),
        ),
    ),
  );
  await assert.rejects(
    verifyPublished(manifest, async () => new Response("", { status: 404 })),
  );
});
test("channel paths stay isolated and arbitrary APK destinations are rejected", () => {
  assert.equal(releasePaths(manifest).manifest, "/latest.json");
  assert.equal(
    releasePaths({
      ...manifest,
      channel: "beta",
      url: manifest.url.replace("/downloads/", "/downloads/beta/"),
    }).manifest,
    "/beta/latest.json",
  );
  assert.throws(() =>
    releasePaths({ ...manifest, url: "https://example.com/app.apk" }),
  );
  assert.throws(() => releasePaths({ ...manifest, channel: "other" }));
});
test("publication requests the existing idempotent worker only after deployment and live verification", async () => {
  const calls: string[] = [];
  let announced = false;
  const result = await publishAndAnnounce(manifest, {
    deploy: async () => calls.push("deploy"),
    verify: async () => calls.push("verify"),
    readAnnouncement: async () => (announced ? manifest : null),
    requestAnnouncement: async () => {
      calls.push("request");
      announced = true;
    },
    wait: async () => {},
  });
  assert.deepEqual(calls, ["deploy", "verify", "request"]);
  assert.equal(result.announced, true);
});
test("failed deployment or verification never requests notification delivery", async () => {
  for (const failing of ["deploy", "verify"]) {
    let requests = 0;
    await assert.rejects(
      publishAndAnnounce(manifest, {
        deploy: async () => {
          if (failing === "deploy") throw Error("failed");
        },
        verify: async () => {
          if (failing === "verify") throw Error("failed");
        },
        requestAnnouncement: async () => requests++,
      }),
    );
    assert.equal(requests, 0);
  }
});
test("recovery verifies published files without redeploying and skips an existing announcement", async () => {
  let deploys = 0,
    requests = 0,
    verifies = 0;
  const result = await publishAndAnnounce(
    manifest,
    {
      deploy: async () => deploys++,
      verify: async () => verifies++,
      readAnnouncement: async () => manifest,
      requestAnnouncement: async () => requests++,
    },
    { announceOnly: true },
  );
  assert.deepEqual([deploys, requests, verifies], [0, 0, 1]);
  assert.equal(result.alreadyAnnounced, true);
});
test("scheduler acceptance without a matching announcement is not reported as delivered", async () => {
  let requests = 0;
  await assert.rejects(
    publishAndAnnounce(
      manifest,
      {
        verify: async () => {},
        readAnnouncement: async () => ({ ...manifest, versionCode: 21 }),
        requestAnnouncement: async () => requests++,
        wait: async () => {},
      },
      { announceOnly: true, attempts: 2 },
    ),
    /not confirmed/,
  );
  assert.equal(requests, 1);
});
