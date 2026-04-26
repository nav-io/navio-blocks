import { existsSync } from "node:fs";
import { basename } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import Database from "better-sqlite3";
import { resolvePathFromEnv } from "./env.js";

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

function candidateDbPaths(): string[] {
  const rawPath = process.env.DB_PATH ?? "./navio-blocks.db";
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

let db: Database.Database | undefined;

/**
 * Wait for the indexer to create a readable database, then open read-only.
 * Avoids SQLITE_CANTOPEN when API and indexer start together (`npm run dev`).
 */
export async function initExplorerDb(): Promise<void> {
  const paths = candidateDbPaths();
  const maxWait = Math.max(
    1000,
    Number(process.env.API_DB_WAIT_MS ?? 120_000) || 120_000
  );
  const pollMs = 500;
  const start = Date.now();
  let lastLog = 0;

  let chosen: string | null = firstReadyPath(paths);
  while (!chosen && Date.now() - start < maxWait) {
    await delay(pollMs);
    chosen = firstReadyPath(paths);
    const now = Date.now();
    if (!chosen && now - lastLog >= 5000) {
      console.warn(
        "[api] Waiting for indexer database (paths: %s). Start the indexer or set API_DB_WAIT_MS.",
        paths.join(" | ")
      );
      lastLog = now;
    }
  }

  if (!chosen) {
    throw new Error(
      `[api] No readable explorer database after ${maxWait}ms. Tried: ${paths.join(", ")}. ` +
        "Create it by starting the indexer first, or fix DB_PATH."
    );
  }

  console.log(`[api] Using database at ${chosen}`);
  db = new Database(chosen, { readonly: true });
  db.pragma("journal_mode = WAL");
}

function getDb(): Database.Database {
  if (!db) {
    throw new Error("[api] Database not initialized; initExplorerDb() must run before handling requests");
  }
  return db;
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
