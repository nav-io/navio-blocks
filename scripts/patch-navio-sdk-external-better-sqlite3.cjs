/**
 * navio-sdk's bundled `dist/index.{js,mjs}` ships with an inlined copy of
 * `better-sqlite3` and the `bindings` package. The bundled `bindings()` resolves
 * the native `.node` addon relative to the wrong directory (e.g.
 * `packages/indexer/build/better_sqlite3.node`) and aborts with:
 *
 *   Could not locate the bindings file. Tried:
 *    → /…/packages/indexer/build/better_sqlite3.node
 *    → /…/packages/indexer/build/Release/better_sqlite3.node
 *    …
 *
 * The fix is to make the SDK load the hoisted `better-sqlite3` package via the
 * real `require`, so `better-sqlite3` resolves its addon from its own
 * `node_modules/better-sqlite3/build/Release/better_sqlite3.node`.
 *
 * Idempotent. Runs from root `postinstall` AND from the indexer's prestart/dev
 * scripts, so it works even if `npm ci --ignore-scripts` was used on prod.
 */
const fs = require("fs");
const path = require("path");

const NEEDLE = "this.Database = require_lib();";
const REPL = 'this.Database = require("better-sqlite3");';

function repoRoot() {
  return path.resolve(__dirname, "..");
}

function candidateFiles() {
  const roots = [
    path.join(repoRoot(), "node_modules", "navio-sdk"),
    path.join(repoRoot(), "packages", "indexer", "node_modules", "navio-sdk"),
  ];
  const files = [];
  for (const r of roots) {
    files.push(path.join(r, "dist", "index.js"));
    files.push(path.join(r, "dist", "index.mjs"));
  }
  return files;
}

function tryPatch(file) {
  if (!fs.existsSync(file)) return "absent";
  const s = fs.readFileSync(file, "utf8");
  if (!s.includes(NEEDLE)) {
    return s.includes(REPL) ? "already" : "missing";
  }
  fs.writeFileSync(file, s.split(NEEDLE).join(REPL));
  return "patched";
}

let anyPresent = false;
let anyChanged = false;
for (const file of candidateFiles()) {
  const r = tryPatch(file);
  if (r === "absent") continue;
  anyPresent = true;
  if (r === "patched") {
    anyChanged = true;
    console.log("[patch-navio-sdk] NodeAdapter now uses external better-sqlite3:", file);
  } else if (r === "already") {
    // Quiet on already-applied to keep prestart logs clean.
  } else if (r === "missing") {
    console.warn(
      "[patch-navio-sdk] expected line missing — navio-sdk bundle may have changed:",
      NEEDLE,
      file
    );
  }
}

if (!anyPresent) {
  console.warn("[patch-navio-sdk] navio-sdk not found under any candidate path; skip");
}

if (anyChanged) {
  console.log("[patch-navio-sdk] done");
}
