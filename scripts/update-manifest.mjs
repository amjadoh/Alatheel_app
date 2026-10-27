import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export function updateManifest(
  bytes,
  versionName,
  versionCode,
  notes,
  channel = "stable",
) {
  if (
    !["stable", "beta"].includes(channel) ||
    !/^\d+\.\d+\.\d+$/.test(versionName) ||
    !Number.isSafeInteger(versionCode) ||
    versionCode < 1 ||
    !bytes.length ||
    bytes.length > 100 * 1024 * 1024
  )
    throw new Error("Invalid release");
  return {
    channel,
    packageId: "com.alatheel.stable",
    versionName,
    versionCode,
    url: `https://alatheel-app-426403695200.web.app/downloads/${channel === "beta" ? "beta/" : ""}Alatheel-${versionName}.apk`,
    size: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    notes,
  };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const apk = process.argv[2];
  const channel = process.argv[3] || "stable";
  if (!apk)
    throw new Error(
      "Usage: node scripts/update-manifest.mjs /path/to/verified-signed.apk [stable|beta]",
    );
  const gradle = await readFile(
    resolve(root, "android/app/build.gradle"),
    "utf8",
  );
  const version = /versionName "([^"]+)"/.exec(gradle)?.[1];
  const code = Number(/versionCode (\d+)/.exec(gradle)?.[1]);
  const pkg = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
  if (version !== pkg.version) throw new Error("Version mismatch");
  const bytes = await readFile(apk);
  const notes = (
    await readFile(resolve(root, "docs/update-notes.txt"), "utf8")
  ).trim();
  const manifest = updateManifest(bytes, version, code, notes, channel);
  const hosting = resolve(root, "downloads-hosting");
  const lane = channel === "beta" ? "beta" : "";
  const downloads = resolve(hosting, "downloads", lane);
  const metadata = resolve(hosting, lane);
  await mkdir(downloads, { recursive: true });
  await mkdir(metadata, { recursive: true });
  await copyFile(apk, resolve(downloads, `Alatheel-${version}.apk`));
  await copyFile(apk, resolve(downloads, "Alatheel-latest.apk"));
  await writeFile(
    resolve(metadata, "latest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
  console.log(JSON.stringify(manifest));
}
