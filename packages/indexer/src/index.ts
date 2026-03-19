import { existsSync } from "node:fs";
import { basename, dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import Database from "better-sqlite3";
import { initDatabase } from "./db/schema.js";
import { Queries } from "./db/queries.js";
import { RpcClient } from "./rpc/client.js";
import type { NetworkType } from "@navio-blocks/shared";
import { Poller } from "./sync/poller.js";
import { updatePeers } from "./sync/peers.js";
import { updatePrice } from "./sync/price.js";

const FILE_DIR = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(FILE_DIR, "../../../");

function initEnv(): string | null {
  const candidates = [
    resolve(process.cwd(), ".env"),
    resolve(PROJECT_ROOT, ".env"),
  ];

  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    loadEnv({ path: candidate });
    return candidate;
  }

  return null;
}

const ENV_PATH = initEnv();

function hasCoreTables(dbPath: string): boolean {
  try {
    const probe = new Database(dbPath, { readonly: true });
    const row = probe
      .prepare(
        `SELECT COUNT(*) AS count
         FROM sqlite_master
         WHERE type = 'table' AND name IN ('blocks', 'transactions', 'outputs', 'inputs')`
      )
      .get() as { count?: number };
    probe.close();
    return (row.count ?? 0) >= 4;
  } catch {
    return false;
  }
}

function resolveDbPath(rawPath: string): string {
  if (isAbsolute(rawPath)) return rawPath;
  const baseDir = ENV_PATH ? dirname(ENV_PATH) : PROJECT_ROOT;
  const primary = resolve(baseDir, rawPath);
  const legacy = resolve(PROJECT_ROOT, "packages/indexer", basename(rawPath));

  if (existsSync(primary) && hasCoreTables(primary)) return primary;
  if (existsSync(legacy) && hasCoreTables(legacy)) {
    if (legacy !== primary) {
      console.warn(
        `[indexer] DB_PATH points to ${primary}, but using legacy DB at ${legacy} (contains indexed data)`
      );
    }
    return legacy;
  }

  return primary;
}

const DB_PATH = resolveDbPath(process.env.DB_PATH ?? "./navio-blocks.db");
const RPC_HOST = process.env.RPC_HOST ?? "127.0.0.1";
const RPC_PORT = parseInt(process.env.RPC_PORT ?? "33677", 10);
const RPC_USER = process.env.RPC_USER ?? "";
const RPC_PASSWORD = process.env.RPC_PASSWORD ?? "";
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL ?? "5000", 10);
const NETWORK = (process.env.NETWORK ?? "mainnet") as NetworkType;
const PEER_INTERVAL = 10 * 60 * 1000; // 10 minutes
const PRICE_INTERVAL = 5 * 60 * 1000; // 5 minutes

function parseArgs(): { reindex: boolean; fromHeight: number } {
  const args = process.argv.slice(2);
  let reindex = false;
  let fromHeight = 0;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--reindex") {
      reindex = true;
    } else if (arg === "--from" || arg === "--from-height") {
      const next = args[i + 1];
      if (next !== undefined && /^\d+$/.test(next)) {
        reindex = true;
        fromHeight = parseInt(next, 10);
        i++;
      } else {
        console.error(`[indexer] --from requires a numeric height argument`);
        process.exit(1);
      }
    } else if (arg.startsWith("--from=") || arg.startsWith("--from-height=")) {
      const val = arg.split("=")[1];
      if (/^\d+$/.test(val)) {
        reindex = true;
        fromHeight = parseInt(val, 10);
      } else {
        console.error(`[indexer] --from requires a numeric height argument`);
        process.exit(1);
      }
    } else if (arg === "--help" || arg === "-h") {
      console.log(`
navio-blocks indexer

Usage:
  npm -w packages/indexer run dev [-- <flags>]
  node dist/index.js [<flags>]

Flags:
  --reindex          Clear all indexed data and resync from genesis (block 0)
  --from <height>    Clear data from <height> onward and resync from there
  --from=<height>    Same as above, alternate syntax
  -h, --help         Show this help
`);
      process.exit(0);
    }
  }

  return { reindex, fromHeight };
}

async function main(): Promise<void> {
  if (!ENV_PATH) {
    console.warn(
      "[indexer] No .env file found in current directory or project root; using process env only"
    );
  } else {
    console.log("[indexer] Loaded env from %s", ENV_PATH);
  }

  if (!RPC_USER || !RPC_PASSWORD) {
    console.error(
      "[indexer] Missing RPC credentials. Set RPC_USER and RPC_PASSWORD in .env or environment."
    );
    process.exit(1);
  }

  console.log("[indexer] Initializing database...");
  const db = initDatabase(DB_PATH);
  const queries = new Queries(db);

  // Handle reindex before starting the poller
  const { reindex, fromHeight } = parseArgs();
  if (reindex) {
    if (fromHeight > 0) {
      console.log("[indexer] Reindexing from height %d...", fromHeight);
      queries.reindexFrom(fromHeight);
      console.log("[indexer] Cleared data from height %d onward", fromHeight);
    } else {
      console.log("[indexer] Full reindex — clearing all indexed data...");
      queries.reindexFrom(0);
      console.log("[indexer] Database cleared, resyncing from genesis");
    }
  }

  console.log("[indexer] Connecting to RPC at %s:%d", RPC_HOST, RPC_PORT);
  const rpc = new RpcClient({
    host: RPC_HOST,
    port: RPC_PORT,
    user: RPC_USER,
    password: RPC_PASSWORD,
  });

  // Auto-detect network from the node if NETWORK is not explicitly set
  let network = NETWORK;
  try {
    const info = (await rpc.getBlockchainInfo()) as Record<string, unknown>;
    const chain = info.chain as string | undefined;
    if (chain) {
      const detected: NetworkType = chain === "main" ? "mainnet" : "testnet";
      if (!process.env.NETWORK) {
        network = detected;
        console.log("[indexer] Auto-detected network from node: %s (chain=%s)", network, chain);
      } else if (detected !== network) {
        console.warn(
          "[indexer] Warning: NETWORK=%s but node reports chain=%s",
          network,
          chain
        );
      }
    }
  } catch (err) {
    console.warn("[indexer] Could not auto-detect network:", err instanceof Error ? err.message : err);
  }

  // Start block sync poller
  console.log("[indexer] Network: %s", network);
  const poller = new Poller(rpc, queries, network);
  poller.start(POLL_INTERVAL);

  // Run initial peer and price updates
  void updatePeers(rpc, queries, network);
  void updatePrice(queries);

  // Set up recurring peer and price updates
  const peerTimer = setInterval(
    () => void updatePeers(rpc, queries, network),
    PEER_INTERVAL
  );
  const priceTimer = setInterval(() => void updatePrice(queries), PRICE_INTERVAL);

  console.log("[indexer] Started");
  console.log("[indexer]   Block polling:  every %dms", POLL_INTERVAL);
  console.log("[indexer]   Peer updates:   every %dms", PEER_INTERVAL);
  console.log("[indexer]   Price updates:  every %dms", PRICE_INTERVAL);
  console.log("[indexer]   Database:       %s", DB_PATH);

  // Graceful shutdown
  function shutdown(): void {
    console.log("\n[indexer] Shutting down...");
    poller.stop();
    clearInterval(peerTimer);
    clearInterval(priceTimer);
    db.close();
    console.log("[indexer] Goodbye");
    process.exit(0);
  }

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

void main();
