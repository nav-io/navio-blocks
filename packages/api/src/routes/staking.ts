import { FastifyInstance } from 'fastify';
import { queryOne, queryAll } from '../db.js';
import { cached } from '../cache.js';
import { currentNetwork } from '../context.js';
import type {
  StakingSummary,
  StakingHistoryPoint,
  StakingActivityPoint,
  StakingCommitment,
  ChartPeriod,
  PaginatedResponse,
} from '@navio-blocks/shared';

/**
 * Staking / cold-staking routes.
 *
 * A staked commitment is an output whose script starts with
 * OP_STAKED_COMMITMENT (indexed as output_type = 'stake'). A *delegated*
 * commitment additionally carries a DATA predicate with the "NVDG" delegation
 * payload (cold staking: a third-party operator holds the commitment opening
 * and produces blocks; only the owner can spend). The index stores that as
 * outputs.delegated = 1. Amounts, operators and reward addresses are
 * BLSCT-hidden / encrypted and are never available here.
 */

/** True when the staking_stats table exists (older DBs may predate it). */
function stakingStatsTableExists(): boolean {
  try {
    const row = queryOne<{ n: number }>(
      `SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'staking_stats'`,
    );
    return (row?.n ?? 0) > 0;
  } catch {
    return false;
  }
}

/** True when outputs.delegated exists (older DBs may predate the column). */
function delegatedColumnExists(): boolean {
  try {
    const cols = queryAll<{ name: string }>(`PRAGMA table_info(outputs)`);
    return cols.some((c) => c.name === 'delegated');
  } catch {
    return false;
  }
}

/** Sampling window + bucket size for a chart period. */
function samplingInterval(period: ChartPeriod): { cutoff: number; interval: number } {
  const now = Math.floor(Date.now() / 1000);
  switch (period) {
    case '24h':
      return { cutoff: now - 86400, interval: 3600 };          // hourly
    case '7d':
      return { cutoff: now - 7 * 86400, interval: 6 * 3600 };  // 6-hourly
    case '30d':
      return { cutoff: now - 30 * 86400, interval: 86400 };    // daily
    case '1y':
      return { cutoff: now - 365 * 86400, interval: 7 * 86400 }; // weekly
    default:
      return { cutoff: now - 7 * 86400, interval: 6 * 3600 };
  }
}

const PERIOD_SCHEMA = {
  type: 'object',
  properties: {
    period: { type: 'string', enum: ['24h', '7d', '30d', '1y'], default: '30d' },
  },
} as const;

export default async function stakingRoutes(app: FastifyInstance) {
  // GET /api/staking/summary — staked-set overview incl. cold-staking delegations.
  app.get('/staking/summary', {
    schema: {
      tags: ['Staking'],
      description:
        'Staked-commitment overview: active / delegated (cold-staked) commitments, lifetime and 24h activity, and the node-side staked set for cross-checking. Amounts are BLSCT-hidden.',
      response: { 200: { type: 'object', additionalProperties: true } },
    },
  }, async (): Promise<StakingSummary> => {
    const network = currentNetwork();
    return cached(`staking:summary:${network}`, 30_000, () => {
      const hasDelegated = delegatedColumnExists();
      const delegatedExpr = hasDelegated ? 'o.delegated' : '0';
      const now = Math.floor(Date.now() / 1000);
      const dayAgo = now - 86400;

      const active = queryOne<{
        active: number;
        delegated: number;
        newest: number | null;
        oldest: number | null;
      }>(
        `SELECT COUNT(*) AS active,
                COALESCE(SUM(${delegatedExpr}), 0) AS delegated,
                MAX(b.timestamp) AS newest,
                MIN(b.timestamp) AS oldest
         FROM outputs o
         JOIN transactions t ON t.txid = o.txid
         JOIN blocks b ON b.height = t.block_height
         LEFT JOIN inputs i ON i.prev_out = o.output_hash
         WHERE o.output_type = 'stake' AND i.prev_out IS NULL`,
      );

      const totals = queryOne<{ created: number; delegated: number; created_24h: number; delegated_24h: number }>(
        `SELECT COUNT(*) AS created,
                COALESCE(SUM(${delegatedExpr}), 0) AS delegated,
                COALESCE(SUM(CASE WHEN b.timestamp >= ? THEN 1 ELSE 0 END), 0) AS created_24h,
                COALESCE(SUM(CASE WHEN b.timestamp >= ? THEN ${delegatedExpr} ELSE 0 END), 0) AS delegated_24h
         FROM outputs o
         JOIN transactions t ON t.txid = o.txid
         JOIN blocks b ON b.height = t.block_height
         WHERE o.output_type = 'stake'`,
        dayAgo,
        dayAgo,
      );

      // Spent commitments: the spending tx's block time is what counts as "when".
      const spent = queryOne<{ spent: number; spent_24h: number }>(
        `SELECT COUNT(*) AS spent,
                COALESCE(SUM(CASE WHEN sb.timestamp >= ? THEN 1 ELSE 0 END), 0) AS spent_24h
         FROM outputs o
         JOIN inputs i ON i.prev_out = o.output_hash
         JOIN transactions st ON st.txid = i.txid
         JOIN blocks sb ON sb.height = st.block_height
         WHERE o.output_type = 'stake'`,
        dayAgo,
      );

      let node: StakingSummary['node'] = null;
      if (stakingStatsTableExists()) {
        const snap = queryOne<{
          timestamp: number;
          active_commitments: number;
          delegated_commitments: number;
          db_active: number;
          db_delegated: number;
        }>(
          `SELECT timestamp, active_commitments, delegated_commitments, db_active, db_delegated
           FROM staking_stats WHERE network = ? ORDER BY timestamp DESC LIMIT 1`,
          network,
        );
        if (snap) {
          node = {
            timestamp: snap.timestamp,
            active_commitments: snap.active_commitments,
            delegated_commitments: snap.delegated_commitments,
            in_sync:
              snap.active_commitments === snap.db_active &&
              snap.delegated_commitments === snap.db_delegated,
          };
        }
      }

      const activeCount = active?.active ?? 0;
      const delegatedCount = active?.delegated ?? 0;
      return {
        active_commitments: activeCount,
        delegated_commitments: delegatedCount,
        plain_commitments: activeCount - delegatedCount,
        delegated_pct: activeCount > 0 ? Math.round((delegatedCount / activeCount) * 10000) / 100 : 0,
        total_created: totals?.created ?? 0,
        total_delegated_created: totals?.delegated ?? 0,
        total_spent: spent?.spent ?? 0,
        created_24h: totals?.created_24h ?? 0,
        delegated_created_24h: totals?.delegated_24h ?? 0,
        spent_24h: spent?.spent_24h ?? 0,
        newest_active_timestamp: active?.newest ?? null,
        oldest_active_timestamp: active?.oldest ?? null,
        node,
      };
    });
  });

  // GET /api/staking/history — node-side staked-set snapshots, bucketed.
  app.get<{ Querystring: { period?: ChartPeriod } }>('/staking/history', {
    schema: {
      tags: ['Staking'],
      description: 'Unspent staked-commitment count over time (node snapshots), total and delegated',
      querystring: PERIOD_SCHEMA,
      response: {
        200: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              timestamp: { type: 'integer' },
              active_commitments: { type: 'integer' },
              delegated_commitments: { type: 'integer' },
            },
          },
        },
      },
    },
  }, async (request): Promise<StakingHistoryPoint[]> => {
    if (!stakingStatsTableExists()) return [];
    const network = currentNetwork();
    const period = (request.query.period ?? '30d') as ChartPeriod;
    // Snapshots are 5-minutely; bucket finer than activity so charts stay smooth.
    const { cutoff, interval } = samplingInterval(period);
    const bucket = Math.max(300, Math.floor(interval / 6));

    const rows = queryAll<{ timestamp: number; active: number; delegated: number }>(
      `SELECT (timestamp / CAST(? AS INTEGER)) * CAST(? AS INTEGER) AS timestamp,
              AVG(active_commitments) AS active,
              AVG(delegated_commitments) AS delegated
       FROM staking_stats
       WHERE network = ? AND timestamp >= ?
       GROUP BY timestamp / CAST(? AS INTEGER)
       ORDER BY timestamp`,
      bucket, bucket, network, cutoff, bucket,
    );
    return rows.map((r) => ({
      timestamp: r.timestamp,
      active_commitments: Math.round(r.active),
      delegated_commitments: Math.round(r.delegated),
    }));
  });

  // GET /api/staking/activity — on-chain stake / delegate / unstake counts per bucket.
  app.get<{ Querystring: { period?: ChartPeriod } }>('/staking/activity', {
    schema: {
      tags: ['Staking'],
      description: 'Staked commitments created (total / delegated) and spent per time bucket, by block time',
      querystring: PERIOD_SCHEMA,
      response: {
        200: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              timestamp: { type: 'integer' },
              created: { type: 'integer' },
              delegated_created: { type: 'integer' },
              spent: { type: 'integer' },
            },
          },
        },
      },
    },
  }, async (request): Promise<StakingActivityPoint[]> => {
    const network = currentNetwork();
    const period = (request.query.period ?? '30d') as ChartPeriod;
    return cached(`staking:activity:${network}:${period}`, 60_000, () => {
      const { cutoff, interval } = samplingInterval(period);
      const delegatedExpr = delegatedColumnExists() ? 'o.delegated' : '0';

      const created = queryAll<{ timestamp: number; created: number; delegated: number }>(
        `SELECT (b.timestamp / CAST(? AS INTEGER)) * CAST(? AS INTEGER) AS timestamp,
                COUNT(*) AS created,
                COALESCE(SUM(${delegatedExpr}), 0) AS delegated
         FROM outputs o
         JOIN transactions t ON t.txid = o.txid
         JOIN blocks b ON b.height = t.block_height
         WHERE o.output_type = 'stake' AND b.timestamp >= ?
         GROUP BY b.timestamp / CAST(? AS INTEGER)`,
        interval, interval, cutoff, interval,
      );
      const spent = queryAll<{ timestamp: number; spent: number }>(
        `SELECT (sb.timestamp / CAST(? AS INTEGER)) * CAST(? AS INTEGER) AS timestamp, COUNT(*) AS spent
         FROM outputs o
         JOIN inputs i ON i.prev_out = o.output_hash
         JOIN transactions st ON st.txid = i.txid
         JOIN blocks sb ON sb.height = st.block_height
         WHERE o.output_type = 'stake' AND sb.timestamp >= ?
         GROUP BY sb.timestamp / CAST(? AS INTEGER)`,
        interval, interval, cutoff, interval,
      );

      const byTs = new Map<number, StakingActivityPoint>();
      const get = (ts: number): StakingActivityPoint => {
        let p = byTs.get(ts);
        if (!p) {
          p = { timestamp: ts, created: 0, delegated_created: 0, spent: 0 };
          byTs.set(ts, p);
        }
        return p;
      };
      for (const r of created) {
        const p = get(r.timestamp);
        p.created = r.created;
        p.delegated_created = r.delegated;
      }
      for (const r of spent) get(r.timestamp).spent = r.spent;
      return [...byTs.values()].sort((a, b) => a.timestamp - b.timestamp);
    });
  });

  // GET /api/staking/commitments — paginated staked commitments.
  app.get<{
    Querystring: { limit?: number; offset?: number; status?: 'active' | 'spent' | 'all'; delegated?: '0' | '1' };
  }>('/staking/commitments', {
    schema: {
      tags: ['Staking'],
      description: 'List staked commitments (newest first) with delegation and spent status',
      querystring: {
        type: 'object',
        properties: {
          limit: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
          offset: { type: 'integer', minimum: 0, default: 0 },
          status: { type: 'string', enum: ['active', 'spent', 'all'], default: 'active' },
          delegated: { type: 'string', enum: ['0', '1'] },
        },
      },
      response: { 200: { type: 'object', additionalProperties: true } },
    },
  }, async (request): Promise<PaginatedResponse<StakingCommitment>> => {
    const limit = Math.min(Number(request.query.limit ?? 25), 100);
    const offset = Number(request.query.offset ?? 0);
    const status = request.query.status ?? 'active';
    const delegatedExpr = delegatedColumnExists() ? 'o.delegated' : '0';

    const conditions = [`o.output_type = 'stake'`];
    const params: unknown[] = [];
    if (status === 'active') conditions.push('i.prev_out IS NULL');
    if (status === 'spent') conditions.push('i.prev_out IS NOT NULL');
    if (request.query.delegated === '1') conditions.push(`${delegatedExpr} = 1`);
    if (request.query.delegated === '0') conditions.push(`${delegatedExpr} = 0`);
    const where = conditions.join(' AND ');

    const from = `FROM outputs o
       JOIN transactions t ON t.txid = o.txid
       JOIN blocks b ON b.height = t.block_height
       LEFT JOIN inputs i ON i.prev_out = o.output_hash
       LEFT JOIN transactions st ON st.txid = i.txid`;

    const total = queryOne<{ n: number }>(`SELECT COUNT(*) AS n ${from} WHERE ${where}`, ...params)?.n ?? 0;
    const rows = queryAll<{
      output_hash: string; txid: string; n: number; block_height: number; timestamp: number;
      delegated: number; spending_txid: string | null; spent_height: number | null;
    }>(
      `SELECT o.output_hash, o.txid, o.n, t.block_height, b.timestamp,
              ${delegatedExpr} AS delegated, i.txid AS spending_txid, st.block_height AS spent_height
       ${from}
       WHERE ${where}
       ORDER BY t.block_height DESC, o.n DESC
       LIMIT ? OFFSET ?`,
      ...params, limit, offset,
    );

    return {
      data: rows.map((r) => ({
        output_hash: r.output_hash,
        txid: r.txid,
        n: r.n,
        block_height: r.block_height,
        timestamp: r.timestamp,
        delegated: r.delegated === 1,
        spent: r.spending_txid != null,
        spending_txid: r.spending_txid ?? null,
        spent_height: r.spent_height ?? null,
      })),
      total,
      limit,
      offset,
    };
  });
}
