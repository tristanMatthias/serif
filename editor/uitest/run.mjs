// Runner for the editor's browser tests.
//
// Each suite is given a `ctx` with a page pointed at a live `serif edit`
// server, plus the helpers to drive it. Suites push results; this file starts
// and stops everything and prints the report.

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { installHelpers, runCases } from "./harness.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");

/**
 * Locate playwright-core, wherever it was installed. Loaded by path it comes
 * back as a CommonJS module, so the exports may sit under `default`.
 */
async function loadPlaywright() {
  const tries = [
    ...[REPO, HERE, process.cwd()].map((b) => path.join(b, "node_modules", "playwright-core", "index.js")),
    "playwright-core",
  ];
  for (const spec of tries) {
    try {
      const mod = await import(spec);
      const chromium = mod.chromium ?? mod.default?.chromium;
      if (chromium) return chromium;
    } catch {
      /* keep looking */
    }
  }
  return null;
}

/** Chromium from a normal Playwright install, or whatever CHROME points at. */
function findChromium() {
  if (process.env.CHROME) return process.env.CHROME;
  const roots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    path.join(os.homedir(), "Library/Caches/ms-playwright"),
    path.join(os.homedir(), ".cache/ms-playwright"),
  ].filter(Boolean);

  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    for (const dir of fs.readdirSync(root).filter((d) => d.startsWith("chromium")).sort().reverse()) {
      for (const rel of [
        "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
        "chrome-mac/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
        "chrome-linux/chrome",
        "chrome-headless-shell-linux64/chrome-headless-shell",
      ]) {
        const exe = path.join(root, dir, rel);
        if (fs.existsSync(exe)) return exe;
      }
    }
  }
  return null;
}

function buildServer() {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "serif-uitest-")), "serif");
  const built = spawnSync("go", ["build", "-o", out, "."], { cwd: REPO, stdio: "inherit" });
  if (built.status !== 0) throw new Error("go build failed");
  return out;
}

/** Start `serif edit` on a temporary workspace and wait for it to answer. */
async function startServer(bin, files, port) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "serif-ws-"));
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  }
  const target = Object.keys(files).length === 1 ? path.join(dir, Object.keys(files)[0]) : dir;
  const proc = spawn(bin, ["edit", target, "--addr", `127.0.0.1:${port}`], { stdio: "ignore" });

  const url = `http://127.0.0.1:${port}/`;
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(url)).ok) return { dir, proc, url };
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  proc.kill();
  throw new Error(`server did not start on ${port}`);
}

/* ---- main ---------------------------------------------------------------- */

const chromium = findChromium();
if (!chromium) {
  console.log("editor UI tests skipped: no Chromium found.\n" +
    "  npm install --no-save playwright-core && npx --yes playwright install chromium");
  process.exit(0);
}

const launcher = await loadPlaywright();
if (!launcher) {
  console.log("editor UI tests skipped: playwright-core is not installed.\n" +
    "  npm install --no-save playwright-core");
  process.exit(0);
}

const bin = buildServer();
const browser = await launcher.launch({ executablePath: chromium });
const results = [];
const problems = [];
let port = 8951;

const ctx = {
  browser,
  results,
  problems,
  /** Open a page on a fresh workspace. Returns { page, dir, stop }. */
  async open(files, { viewport } = {}) {
    const { dir, proc, url } = await startServer(bin, files, port++);
    const page = await browser.newPage(viewport ? { viewport } : {});
    page.on("pageerror", (e) => problems.push(`page error: ${String(e).split("\n")[0]}`));
    page.on("response", (r) => {
      // 409 on a save is a tested outcome, not a fault: it is how the editor
      // refuses to overwrite a file that changed underneath it.
      const expected = r.ok() || r.status() === 409 || r.url().endsWith("/favicon.ico");
      if (!expected) problems.push(`HTTP ${r.status()} ${new URL(r.url()).pathname}`);
    });
    await page.goto(url);
    await page.waitForSelector("#doc");
    return {
      page, dir,
      stop: async () => { await page.close(); proc.kill(); },
    };
  },
  record(name, ok, detail = "") {
    results.push({ name, ok, detail });
  },
};

const only = process.argv[2];
for (const suite of ["editing", "lists", "document", "workspace", "matrix"]) {
  if (only && suite !== only) continue;
  const mod = await import(path.join(HERE, `${suite}.mjs`));

  // A suite is either a table of cases with the workspace to run them in, or —
  // where a table would not say it clearly — a run() of its own.
  // A suite is a list of groups: each names the workspace to open and the
  // table of cases to run in it. `cases`/`files` at the top level is shorthand
  // for a single group.
  const groups = [
    ...(mod.cases ? [{ files: mod.files, cases: mod.cases, viewport: mod.viewport }] : []),
    ...(mod.groups ?? []),
  ];
  for (const group of groups) {
    const session = await ctx.open(group.files, group.viewport ? { viewport: group.viewport } : {});
    await session.page.waitForTimeout(300);
    await installHelpers(session.page);
    await runCases(ctx, session, group.cases);
    await session.stop();
  }
  if (!groups.length) await mod.run(ctx);
}

await browser.close();

let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`${r.ok ? "  ok  " : "FAIL  "}${r.name}`);
  if (!r.ok && r.detail) console.log(r.detail.replace(/^/gm, "        "));
}
if (problems.length) {
  console.log("\nbrowser problems:");
  for (const p of [...new Set(problems)]) console.log("  " + p);
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed || problems.length ? 1 : 0);
