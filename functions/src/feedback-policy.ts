import { createPublicKey, verify, type KeyObject } from "node:crypto";
export const FEEDBACK_REPO = "amjadoh/Alatheel_app";
export const BRIDGE_AUDIENCE = "alatheel-app-feedback";
export const FEEDBACK_LIMITS = { files: 5, fileBytes: 10 * 1024 * 1024, totalBytes: 20 * 1024 * 1024, chunkBytes: 384 * 1024, text: 6000 };
const extensions = new Set("jpg jpeg png webp gif heic heif pdf txt csv doc docx xls xlsx ppt pptx zip mp4 mp3 m4a wav".split(" "));
function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
export function feedbackManifest(input: any) {
  const text = String(input.text || "").trim();
  check(text.length <= FEEDBACK_LIMITS.text, "الملاحظة أطول من الحد المسموح");
  check(Array.isArray(input.files) && input.files.length <= FEEDBACK_LIMITS.files, "الحد خمسة مرفقات لكل ملاحظة");
  const files = input.files.map((f: any, index: number) => {
    const name = String(f.name || "").replace(/[\u0000-\u001f/\\]/g, "_").slice(0, 160);
    const extension = name.split(".").at(-1)?.toLowerCase() || "";
    check(name && extensions.has(extension), "نوع المرفق غير مدعوم؛ استخدم صورة أو مستندًا أو ملفًا مضغوطًا أو مقطعًا");
    check(Number.isSafeInteger(f.size) && f.size > 0 && f.size <= FEEDBACK_LIMITS.fileBytes, "حجم المرفق يجب ألا يتجاوز 10 ميجابايت");
    check(/^[a-f0-9]{64}$/.test(String(f.sha256)), "بصمة المرفق غير صحيحة");
    return { index, name, extension, size: f.size, sha256: f.sha256,
      mime: String(f.mime || "application/octet-stream").slice(0, 100), chunks: Math.ceil(f.size / FEEDBACK_LIMITS.chunkBytes) };
  });
  check(text || files.length, "اكتب ملاحظة أو أرفق ملفًا");
  check(files.reduce((n: number, f: any) => n + f.size, 0) <= FEEDBACK_LIMITS.totalBytes, "إجمالي المرفقات يجب ألا يتجاوز 20 ميجابايت");
  check(/^\d+\.\d+\.\d+$/.test(String(input.version)), "إصدار التطبيق غير صحيح");
  return { text, files, version: String(input.version) };
}
export function validateBridgeClaims(claims: any, now = Date.now()) {
  const seconds = Math.floor(now / 1000);
  check(claims.iss === "https://token.actions.githubusercontent.com" && claims.aud === BRIDGE_AUDIENCE, "Invalid issuer or audience");
  check(claims.repository === FEEDBACK_REPO && String(claims.repository_id) === "1418505579" && String(claims.repository_owner_id) === "341951948", "Wrong repository");
  const allowedSubjects = new Set([
    "repo:amjadoh/Alatheel_app:ref:refs/heads/main",
    "repo:amjadoh@341951948/Alatheel_app@1418505579:ref:refs/heads/main",
  ]);
  check(claims.repository_visibility === "private" && claims.ref === "refs/heads/main" && allowedSubjects.has(claims.sub), "Wrong repository context");
  check(claims.workflow_ref === FEEDBACK_REPO + "/.github/workflows/feedback-sync.yml@refs/heads/main", "Wrong workflow");
  check(["schedule", "workflow_dispatch"].includes(claims.event_name), "Wrong event");
  check(Number.isFinite(claims.exp) && claims.exp > seconds && claims.exp <= seconds + 900 && Number.isFinite(claims.nbf) && claims.nbf <= seconds + 30, "Expired or premature token");
  check(/^\d+$/.test(String(claims.run_id)) && /^\d+$/.test(String(claims.run_attempt)), "Invalid run identity");
  return String(claims.run_id) + ":" + String(claims.run_attempt);
}
export async function verifyBridgeToken(token: string, lookup: (kid: string) => Promise<KeyObject>, now = Date.now()) {
  check(token.length < 20000, "Invalid token");
  const parts = token.split("."); check(parts.length === 3, "Invalid token");
  const header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
  check(header.alg === "RS256" && typeof header.kid === "string", "Invalid signing algorithm");
  const key = await lookup(header.kid);
  check(verify("RSA-SHA256", Buffer.from(parts[0] + "." + parts[1]), key, Buffer.from(parts[2], "base64url")), "Invalid signature");
  const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  return validateBridgeClaims(claims, now);
}
let keyCache: { expires: number; keys: any[] } | undefined;
export async function githubSigningKey(kid: string) {
  if (!keyCache || keyCache.expires <= Date.now() || !keyCache.keys.some(k => k.kid === kid)) {
    const r = await fetch("https://token.actions.githubusercontent.com/.well-known/jwks", { signal: AbortSignal.timeout(10000), redirect: "error" });
    check(r.ok, "OIDC keys unavailable");
    const data = await r.json() as any;
    check(Array.isArray(data.keys) && data.keys.length < 30, "Invalid OIDC keys");
    keyCache = { expires: Date.now() + 3600000, keys: data.keys };
  }
  const jwk = keyCache.keys.find(k => k.kid === kid && k.kty === "RSA" && k.use === "sig");
  check(jwk, "Unknown signing key");
  return createPublicKey({ key: jwk, format: "jwk" });
}
