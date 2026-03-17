import { FastifyInstance } from 'fastify';
import { queryOne, queryAll, queryScalar } from '../db.js';
import { rpcCall } from '../rpc.js';
import type { NetworkStats, ChartPoint, ChartPeriod } from '@navio-blocks/shared';

interface MempoolRpcResult {
  size: number;
  bytes: number;
}

interface NetworkInfoRpcResult {
  connections: number;
}

/** Calculate the cutoff timestamp and grouping format for a chart period. */
function periodConfig(period: ChartPeriod): { cutoff: number; groupSql: string } {
  const now = Math.floor(Date.now() / 1000);
  switch (period) {
    case '24h':
      return { cutoff: now - 86400, groupSql: "(timestamp / 3600) * 3600" };
    case '7d':
      return { cutoff: now - 7 * 86400, groupSql: "(timestamp / 3600) * 3600" };
    case '30d':
      return { cutoff: now - 30 * 86400, groupSql: "(timestamp / 86400) * 86400" };
    default:
      return { cutoff: now - 86400, groupSql: "(timestamp / 3600) * 3600" };
  }
}

export default async function statsRoutes(app: FastifyInstance) {
  // GET /api/stats — Network overview
  app.get('/api/stats', {
    schema: {
      tags: ['Stats'],
      description: 'Network overview statistics',
      response: {
        200: {
          type: 'object',
          properties: {
            height: { type: 'integer' },
            difficulty: { type: 'number' },
            mempool_size: { type: 'integer' },
            mempool_bytes: { type: 'integer' },
            blsct_percentage: { type: 'number' },
            avg_block_time: { type: 'number' },
            total_outputs: { type: 'integer' },
            hash_rate: { type: 'number' },
            connections: { type: 'integer' },
          },
        },
      },
    },
  }, async (): Promise<NetworkStats> => {
    const height = queryScalar<number>('SELECT COALESCE(MAX(height), 0) FROM blocks');

    const latestBlock = queryOne<{ difficulty: number }>(
      'SELECT difficulty FROM blocks WHERE height = ?',
      height,
    );
    const difficulty = latestBlock?.difficulty ?? 0;

    // Exclude coinbase transactions from transaction metrics.
    const totalTxs = queryScalar<number>(
      'SELECT COUNT(*) FROM transactions WHERE is_coinbase = 0',
    );

    // Count outputs from non-coinbase transactions, excluding transparent fee outputs.
    const totalOutputs = queryScalar<number>(
      `SELECT COUNT(*)
       FROM outputs o
       JOIN transactions t ON t.txid = o.txid
       WHERE t.is_coinbase = 0
         AND NOT (
           o.is_blsct = 0
           AND COALESCE(o.value_sat, 0) > 0
         )
         AND COALESCE(o.output_hash, '') <> ''`,
    );

    const blsctCount = queryScalar<number>(
      'SELECT COUNT(*) FROM transactions WHERE is_coinbase = 0 AND is_blsct = 1',
    );
    const blsctPercentage = totalTxs > 0 ? (blsctCount / totalTxs) * 100 : 0;

    // Average block time from last 100 blocks
    const recentBlocks = queryAll<{ timestamp: number }>(
      'SELECT timestamp FROM blocks ORDER BY height DESC LIMIT 101',
    );
    let avgBlockTime = 0;
    if (recentBlocks.length >= 2) {
      const diffs: number[] = [];
      for (let i = 0; i < recentBlocks.length - 1; i++) {
        diffs.push(recentBlocks[i].timestamp - recentBlocks[i + 1].timestamp);
      }
      avgBlockTime = diffs.reduce((a, b) => a + b, 0) / diffs.length;
    }

    // Estimate hash rate from difficulty: hashRate = difficulty * 2^32 / blockTime
    const hashRate = avgBlockTime > 0 ? (difficulty * Math.pow(2, 32)) / avgBlockTime : 0;

    // Mempool and connections from RPC (with fallback)
    let mempoolSize = 0;
    let mempoolBytes = 0;
    let connections = 0;

    try {
      const mempoolInfo = await rpcCall<MempoolRpcResult>('getmempoolinfo');
      mempoolSize = mempoolInfo.size;
      mempoolBytes = mempoolInfo.bytes;
    } catch {
      // RPC unavailable — return zeros
    }

    try {
      const networkInfo = await rpcCall<NetworkInfoRpcResult>('getnetworkinfo');
      connections = networkInfo.connections;
    } catch {
      // Fallback: count peers from DB
      try {
        connections = queryScalar<number>('SELECT COUNT(*) FROM peers');
      } catch {
        // peers table may not exist
      }
    }

    return {
      height,
      difficulty,
      mempool_size: mempoolSize,
      mempool_bytes: mempoolBytes,
      blsct_percentage: Math.round(blsctPercentage * 100) / 100,
      avg_block_time: Math.round(avgBlockTime * 100) / 100,
      total_outputs: totalOutputs,
      hash_rate: Math.round(hashRate),
      connections,
    };
  });

  // GET /api/stats/chart — Chart data for block times and tx counts
  app.get<{
    Querystring: { period?: ChartPeriod };
  }>('/api/stats/chart', {
    schema: {
      tags: ['Stats'],
      description: 'Chart data for block times and transaction counts',
      querystring: {
        type: 'object',
        properties: {
          period: { type: 'string', enum: ['24h', '7d', '30d'], default: '24h' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            block_times: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  timestamp: { type: 'integer' },
                  value: { type: 'number' },
                },
              },
            },
            tx_counts: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  timestamp: { type: 'integer' },
                  value: { type: 'number' },
                },
              },
            },
          },
        },
      },
    },
  }, async (request): Promise<{ block_times: ChartPoint[]; tx_counts: ChartPoint[] }> => {
    const period = (request.query.period ?? '24h') as ChartPeriod;
    const { cutoff, groupSql } = periodConfig(period);

    // Block times: average time between consecutive blocks, grouped by period bucket
    // We compute per-block time differences and then average within each bucket.
    const blockTimeRows = queryAll<{ bucket: number; avg_time: number }>(
      `WITH block_diffs AS (
        SELECT
          b.height,
          b.timestamp,
          b.timestamp - prev.timestamp AS diff
        FROM blocks b
        JOIN blocks prev ON prev.height = b.height - 1
        WHERE b.timestamp >= ?
      )
      SELECT
        ${groupSql} AS bucket,
        AVG(diff) AS avg_time
      FROM block_diffs
      GROUP BY bucket
      ORDER BY bucket`,
      cutoff,
    );

    const blockTimes: ChartPoint[] = blockTimeRows.map((r) => ({
      timestamp: r.bucket,
      value: Math.round(r.avg_time * 100) / 100,
    }));

    // Transaction counts per bucket
    const txCountRows = queryAll<{ bucket: number; cnt: number }>(
      `SELECT
        ${groupSql} AS bucket,
        COUNT(*) AS cnt
      FROM transactions t
      JOIN blocks b ON b.height = t.block_height
      WHERE b.timestamp >= ?
      GROUP BY bucket
      ORDER BY bucket`,
      cutoff,
    );

    const txCounts: ChartPoint[] = txCountRows.map((r) => ({
      timestamp: r.bucket,
      value: r.cnt,
    }));

    return { block_times: blockTimes, tx_counts: txCounts };
  });
}
