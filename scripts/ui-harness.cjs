const path = require("node:path");
const { createRequire } = require("node:module");
const { spawn } = require("node:child_process");

const requireQA = process.env.QA_NODE_MODULES
  ? createRequire(path.join(process.env.QA_NODE_MODULES, "_qa.cjs"))
  : require;
const { chromium } = requireQA("playwright");

async function startVite(base, probe, options = {}) {
  if (process.env.QA_BASE_URL && !options.force) return;
  const url = new URL(base);
  const server = spawn(
    process.execPath,
    ["node_modules/vite/bin/vite.js", "--config", "vite.qa.config.ts", "--host", url.hostname, "--port", url.port, "--strictPort"],
    { stdio: "ignore" },
  );
  for (let i = 0; i < (options.attempts || 120); i++) {
    try {
      if ((await fetch(new URL(probe, base))).ok) return server;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, options.delay || 200));
  }
  server.kill();
  throw new Error(options.error || "QA server did not start");
}

const launchBrowser = () => chromium.launch({
  headless: true,
  ...(process.env.QA_CHROME ? { executablePath: process.env.QA_CHROME } : {}),
});

module.exports = { chromium, launchBrowser, startVite };
