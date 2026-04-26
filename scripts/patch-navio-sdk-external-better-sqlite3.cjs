/**
 * navio-sdk's dist/index.js bundles better-sqlite3; the bundled `bindings` helper
 * resolves the .node addon relative to the wrong directory (e.g. packages/indexer).
 * Load the hoisted package instead so the native addon is found.
 *
 * Idempotent; runs from root `postinstall` after npm installs navio-sdk.
 */
const fs = require("fs");
const path = require("path");

const needle = "this.Database = require_lib();";
const repl = 'this.Database = require("better-sqlite3");';

const candidates = [
  path.join(__dirname, "..", "node_modules", "navio-sdk", "dist", "index.js"),
  path.join(
    __dirname,
    "..",
    "packages",
    "indexer",
    "node_modules",
    "navio-sdk",
    "dist",
    "index.js"
  ),
];

function tryPatch(file) {
  if (!fs.existsSync(file)) return "absent";
  let s = fs.readFileSync(file, "utf8");
  if (s.includes(repl)) return "already";
  if (!s.includes(needle)) return "missing";
  fs.writeFileSync(file, s.replace(needle, repl));
  return "patched";
}

let anyPresent = false;
for (const file of candidates) {
  const r = tryPatch(file);
  if (r === "absent") continue;
  anyPresent = true;
  if (r === "already") {
    console.log("[patch-navio-sdk] already applied:", file);
  } else if (r === "missing") {
    console.warn(
      "[patch-navio-sdk] expected line missing — navio-sdk version may have changed:",
      needle,
      file
    );
  } else {
    console.log("[patch-navio-sdk] NodeAdapter now uses external better-sqlite3:", file);
  }
}

if (!anyPresent) {
  console.warn("[patch-navio-sdk] navio-sdk not found under any candidate path; skip");
}
