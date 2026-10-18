const assert = require("node:assert/strict"),
  fs = require("node:fs/promises"),
  path = require("node:path"),
  os = require("node:os"),
  { spawn } = require("node:child_process"),
  { createRequire } = require("node:module");
const requireQA = process.env.QA_NODE_MODULES
  ? createRequire(path.join(process.env.QA_NODE_MODULES, "_qa.cjs"))
  : require;
const { chromium } = requireQA("playwright");
const base = `http://127.0.0.1:${process.env.QA_AUTH_PORT || 5184}`,
  report = { checks: [], errors: [] };
let server, context, profile;
const now = Math.floor(Date.now() / 1000),
  uid = "isolated-auth-user";
const encode = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const token =
  encode({ alg: "none", typ: "JWT" }) +
  "." +
  encode({
    iss: "https://securetoken.google.com/demo-alatheel-auth",
    aud: "demo-alatheel-auth",
    auth_time: now,
    user_id: uid,
    sub: uid,
    iat: now,
    exp: now + 3600,
    email: "auth@example.test",
    firebase: {
      sign_in_provider: "google.com",
      identities: { "google.com": ["auth@example.test"] },
    },
  }) +
  ".";
let networkDown = false;
async function launch({ blockedLocal = false, blockedIndexed = false } = {}) {
  context = await chromium.launchPersistentContext(profile, {
    headless: true,
    executablePath: process.env.QA_CHROME || undefined,
    viewport: { width: 390, height: 844 },
  });
  if (blockedLocal || blockedIndexed)
    await context.addInitScript(
      ({ blockedLocal, blockedIndexed }) => {
        if (blockedLocal)
          Object.defineProperty(window, "localStorage", {
            get() {
              throw new DOMException(
                "Blocked by isolated test",
                "SecurityError",
              );
            },
          });
        if (blockedIndexed)
          Object.defineProperty(window, "indexedDB", {
            get() {
              throw new DOMException(
                "Blocked by isolated test",
                "SecurityError",
              );
            },
          });
      },
      { blockedLocal, blockedIndexed },
    );
  await context.route("**/*", async (route) => {
    const url = route.request().url();
    if (url.startsWith(base)) return route.continue();
    if (
      !url.startsWith("https://identitytoolkit.googleapis.com/") &&
      !url.startsWith("https://securetoken.googleapis.com/")
    )
      return route.abort();
    if (networkDown) return route.abort("internetdisconnected");
    if (route.request().method() === "OPTIONS")
      return route.fulfill({
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-headers": "*",
          "access-control-allow-methods": "POST,GET,OPTIONS",
        },
      });
    let result;
    if (url.includes("accounts:signInWithIdp"))
      result = {
        localId: uid,
        idToken: token,
        refreshToken: "isolated-refresh-fixture",
        expiresIn: "3600",
        email: "auth@example.test",
        displayName: "Isolated QA",
        providerId: "google.com",
        registered: true,
      };
    else if (url.includes("accounts:lookup"))
      result = {
        users: [
          {
            localId: uid,
            email: "auth@example.test",
            displayName: "Isolated QA",
            emailVerified: true,
            providerUserInfo: [
              {
                providerId: "google.com",
                rawId: "auth@example.test",
                email: "auth@example.test",
              },
            ],
          },
        ],
      };
    else if (url.includes("securetoken.googleapis.com"))
      result = {
        access_token: token,
        expires_in: "3600",
        refresh_token: "isolated-refresh-fixture",
        token_type: "Bearer",
        user_id: uid,
        project_id: "demo-alatheel-auth",
      };
    else throw new Error("Unexpected isolated auth request");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify(result),
    });
  });
  return context.pages()[0] || (await context.newPage());
}
async function open(page, legacy = false) {
  await page.goto(
    base + "/tests/auth-continuity.html" + (legacy ? "?legacy=1" : ""),
    { waitUntil: "domcontentloaded", timeout: 60000 },
  );
  await page.waitForFunction(
    () => window.__authQA?.state !== "starting" && !!window.__authQA,
    undefined,
    { timeout: 60000 },
  );
}
async function close() {
  await context.close();
  context = null;
}
async function fresh() {
  profile = await fs.mkdtemp(path.join(os.tmpdir(), "alatheel-auth-"));
}
function pass(name) {
  report.checks.push(name);
  console.log("PASS", name);
}
(async () => {
  server = spawn(
    process.execPath,
    [
      "node_modules/vite/bin/vite.js",
      "--host",
      "127.0.0.1",
      "--port",
      new URL(base).port,
      "--strictPort",
    ],
    { stdio: "ignore" },
  );
  for (let i = 0; i < 160; i++) {
    try {
      if ((await fetch(base)).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
    if (i === 159) throw new Error("Auth test server did not start");
  }
  await fresh();
  let page = await launch();
  await open(page);
  assert.equal(await page.evaluate(() => window.__authQA.state), "ready");
  await page.evaluate(() => window.__authQA.signIn());
  assert.equal(await page.evaluate(() => window.__authQA.snapshot().uid), uid);
  await close();
  networkDown = true;
  page = await launch();
  await open(page);
  assert.equal(await page.evaluate(() => window.__authQA.snapshot().uid), uid);
  pass(
    "Firebase session survives a full browser process restart without network",
  );
  assert.equal(await page.evaluate(() => window.__authQA.refresh()), "retry");
  assert.equal(await page.evaluate(() => window.__authQA.snapshot().uid), uid);
  pass("Failed token refresh keeps the authenticated user");
  networkDown = false;
  assert.equal(
    await page.evaluate(() => window.__authQA.refresh()),
    "refreshed",
  );
  assert.equal(await page.evaluate(() => window.__authQA.snapshot().uid), uid);
  pass("Connection recovery refreshes the same account without Google sign-in");
  await page.evaluate(() => window.__authQA.signOut());
  await close();
  page = await launch();
  await open(page);
  assert.equal(await page.evaluate(() => window.__authQA.snapshot().uid), null);
  pass("Explicit sign-out remains signed out after process restart");
  await close();
  await fresh();
  page = await launch();
  await open(page, true);
  await page.evaluate(() => window.__authQA.signIn());
  await close();
  page = await launch({ blockedLocal: true });
  await open(page, true);
  assert.equal(await page.evaluate(() => window.__authQA.snapshot().uid), uid);
  assert.equal(
    await page.evaluate(() => window.__authQA.forceLegacyLocal()),
    "failed",
  );
  await close();
  page = await launch();
  await open(page, true);
  assert.equal(await page.evaluate(() => window.__authQA.snapshot().uid), null);
  pass(
    "Reproduced previous forced-local-storage failure deleting the saved session",
  );
  await close();
  await fresh();
  page = await launch({ blockedLocal: true });
  await open(page);
  await page.evaluate(() => window.__authQA.signIn());
  await close();
  page = await launch({ blockedLocal: true });
  await open(page);
  assert.equal(await page.evaluate(() => window.__authQA.snapshot().uid), uid);
  pass(
    "IndexedDB persistence survives restart when localStorage is unavailable",
  );
  await close();
  await fresh();
  page = await launch({ blockedIndexed: true });
  await open(page);
  await page.evaluate(() => window.__authQA.signIn());
  await close();
  page = await launch({ blockedIndexed: true });
  await open(page);
  assert.equal(await page.evaluate(() => window.__authQA.snapshot().uid), uid);
  pass("Local storage fallback survives restart when IndexedDB is unavailable");
  await close();
  await fresh();
  page = await launch({ blockedLocal: true, blockedIndexed: true });
  await open(page);
  assert.equal(await page.evaluate(() => window.__authQA.state), "blocked");
  assert.equal(
    await page.evaluate(() => window.__authQA.error),
    "auth/persistence-unavailable",
  );
  pass(
    "Unavailable durable storage blocks sign-in instead of accepting a memory-only session",
  );
})()
  .catch((e) => {
    report.errors.push(e.message);
    console.error(e.stack);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (context) await close();
    server?.kill();
    await fs.mkdir("qa-results", { recursive: true });
    await fs.writeFile(
      "qa-results/auth-continuity.json",
      JSON.stringify(report, null, 2),
    );
  });
