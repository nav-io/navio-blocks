/**
 * navio-sdk's dist/index.js bundles better-sqlite3; the bundled `bindings` helper
 * resolves the .node addon relative to the wrong directory (e.g. packages/indexer).
 * Load the hoisted package instead so the native addon is found.
 *
 * Idempotent; runs from root `postinstall` after npm installs navio-sdk.
 */
const fs = require("fs");
const path = require("path");

const file = path.join(
  __dirname,
  "..",
  "node_modules",
  "navio-sdk",
  "dist",
  "index.js"
);

const needle = "this.Database = require_lib();";
const repl = 'this.Database = require("better-sqlite3");';

if (!fs.existsSync(file)) {
  console.warn(
    "[patch-navio-sdk] navio-sdk not found, skip:",
    file
  );
  process.exit(0);
}

let s = fs.readFileSync(file, "utf8");
if (s.includes(repl)) {
  console.log("[patch-navio-sdk] already applied");
  process.exit(0);
}
if (!s.includes(needle)) {
  console.warn(
    "[patch-navio-sdk] expected line missing — navio-sdk version may have changed:",
    needle
  );
  process.exit(0);
}

s = s.replace(needle, repl);
fs.writeFileSync(file, s);
console.log("[patch-navio-sdk] NodeAdapter now uses external better-sqlite3");
