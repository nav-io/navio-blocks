import { existsSync } from "node:fs";
import { basename } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import Database from "better-sqlite3";
import type { NetworkType } from "@navio-blocks/shared";
import { resolvePathFromEnv } from "./env.js";
import { NETWORKS, currentNetwork } from "./context.js";

function hasCoreTables(dbPath: string): boolean {
  try {
    const probe = new Database(dbPath, { readonly: true });
    const rows = probe
      .prepare(
        `SELECT COUNT(*) AS count
         FROM sqlite_master
         WHERE type = 'table' AND name IN ('blocks', 'transactions', 'outputs', 'inputs')`
      )
      .get() as { count?: number };
    probe.close();
    return (rows.count ?? 0) >= 4;
  } catch {
    return false;
  }
}

/** Raw DB_PATH env value for a network (relative or absolute). */
function rawDbPath(network: NetworkType): string {
  if (network === "testnet") {
    return process.env.TESTNET_DB_PATH ?? "./navio-blocks.testnet.db";
  }
  return process.env.DB_PATH ?? "./navio-blocks.db";
}

function candidateDbPaths(network: NetworkType): string[] {
  const rawPath = rawDbPath(network);
  const primary = resolvePathFromEnv(rawPath);
  const indexerFallback = resolvePathFromEnv(
    `./packages/indexer/${basename(rawPath)}`
  );
  return [...new Set([primary, indexerFallback])];
}

function firstReadyPath(paths: string[]): string | null {
  for (const p of paths) {
    if (existsSync(p) && hasCoreTables(p)) return p;
  }
  return null;
}

const handles = new Map<NetworkType, Database.Database>();

/**
 * Wait for the indexer(s) to create readable databases, then open them
 * read-only. Mainnet is required; testnet is optional so the explorer still
 * boots if only the mainnet indexer is running (testnet routes then error
 * until its database appears — restart the API to pick it up).
 */
export async function initExplorerDb(): Promise<void> {
  const maxWait = Math.max(
    1000,
    Number(process.env.API_DB_WAIT_MS ?? 120_000) || 120_000
  );
  const pollMs = 500;
  const start = Date.now();
  let lastLog = 0;

  // Block on mainnet (the default network); poll until ready or timeout.
  const mainnetPaths = candidateDbPaths("mainnet");
  let mainnetPath = firstReadyPath(mainnetPaths);
  while (!mainnetPath && Date.now() - start < maxWait) {
    await delay(pollMs);
    mainnetPath = firstReadyPath(mainnetPaths);
    const now = Date.now();
    if (!mainnetPath && now - lastLog >= 5000) {
      console.warn(
        "[api] Waiting for mainnet database (paths: %s). Start the indexer or set API_DB_WAIT_MS.",
        mainnetPaths.join(" | ")
      );
      lastLog = now;
    }
  }

  if (!mainnetPath) {
    throw new Error(
      `[api] No readable mainnet database after ${maxWait}ms. Tried: ${mainnetPaths.join(", ")}. ` +
        "Create it by starting the mainnet indexer first, or fix DB_PATH."
    );
  }
  openHandle("mainnet", mainnetPath);

  // Testnet is best-effort: open if already present, otherwise warn and skip.
  const testnetPaths = candidateDbPaths("testnet");
  const testnetPath = firstReadyPath(testnetPaths);
  if (testnetPath) {
    openHandle("testnet", testnetPath);
  } else {
    console.warn(
      "[api] No readable testnet database (paths: %s). Testnet routes will be unavailable until it exists and the API restarts.",
      testnetPaths.join(" | ")
    );
  }
}

function openHandle(network: NetworkType, dbPath: string): void {
  console.log(`[api] Using ${network} database at ${dbPath}`);
  const handle = new Database(dbPath, { readonly: true });
  handle.pragma("journal_mode = WAL");
  handles.set(network, handle);
}

function getDb(network: NetworkType = currentNetwork()): Database.Database {
  const handle = handles.get(network);
  if (!handle) {
    throw new Error(
      `[api] No database available for network '${network}'. ` +
        "Ensure its indexer has run and the API was (re)started."
    );
  }
  return handle;
}

/** True if a database is mounted for the given (or current) network. */
export function hasDb(network: NetworkType = currentNetwork()): boolean {
  return handles.has(network);
}

/**
 * Get a single row from a query, or undefined if none found.
 */
export function queryOne<T>(sql: string, ...params: unknown[]): T | undefined {
  return getDb().prepare(sql).get(...params) as T | undefined;
}

/**
 * Get all rows from a query.
 */
export function queryAll<T>(sql: string, ...params: unknown[]): T[] {
  return getDb().prepare(sql).all(...params) as T[];
}

/**
 * Get a single scalar value from a query.
 */
export function queryScalar<T = number>(sql: string, ...params: unknown[]): T {
  const row = getDb().prepare(sql).get(...params) as Record<string, T>;
  return Object.values(row)[0];
}
