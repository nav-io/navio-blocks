import { existsSync } from "node:fs";
import { basename } from "node:path";
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

function resolveDbPath(): string {
  const rawPath = process.env.DB_PATH ?? "./navio-blocks.db";
  const primary = resolvePathFromEnv(rawPath);
  if (existsSync(primary) && hasCoreTables(primary)) return primary;

  const indexerFallback = resolvePathFromEnv(
    `./packages/indexer/${basename(rawPath)}`
  );
  if (existsSync(indexerFallback) && hasCoreTables(indexerFallback)) {
    return indexerFallback;
  }

  if (existsSync(primary)) return primary;
  if (existsSync(indexerFallback)) return indexerFallback;

  return primary;
}

const dbPath = resolveDbPath();

console.log(`[api] Using database at ${dbPath}`);

const db = new Database(dbPath, { readonly: true });

// Enable WAL mode for better concurrent read performance
db.pragma("journal_mode = WAL");

/**
 * Get a single row from a query, or undefined if none found.
 */
export function queryOne<T>(sql: string, ...params: unknown[]): T | undefined {
  return db.prepare(sql).get(...params) as T | undefined;
}

/**
 * Get all rows from a query.
 */
export function queryAll<T>(sql: string, ...params: unknown[]): T[] {
  return db.prepare(sql).all(...params) as T[];
}

/**
 * Get a single scalar value from a query.
 */
export function queryScalar<T = number>(sql: string, ...params: unknown[]): T {
  const row = db.prepare(sql).get(...params) as Record<string, T>;
  return Object.values(row)[0];
}
