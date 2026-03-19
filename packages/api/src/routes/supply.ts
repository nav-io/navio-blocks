import { FastifyInstance } from 'fastify';
import { queryOne, queryAll, queryScalar } from '../db.js';
import { cached } from '../cache.js';
import type {
  NetworkType,
  SupplyInfo,
  BlockSupply,
  SupplyChartPoint,
} from '@navio-blocks/shared';

const MAX_SUPPLY = 25_000_000_000_000_000; // 250,000,000 NAV * 1e8 satoshis

type SupplyChartPeriod = '24h' | '7d' | '30d' | '1y' | 'all';

/**
 * Return a UNIX-timestamp cutoff and a sampling step (every Nth row) so the
 * result set stays under ~500 points.
 */
function chartPeriodConfig(
  period: SupplyChartPeriod,
  totalRows: number,
): { cutoff: number | null; step: number } {
  const now = Math.floor(Date.now() / 1000);
  const TARGET_POINTS = 500;

  let cutoff: number | null = null;
  switch (period) {
    case '24h':
      cutoff = now - 86_400;
      break;
    case '7d':
      cutoff = now - 7 * 86_400;
      break;
    case '30d':
      cutoff = now - 30 * 86_400;
      break;
    case '1y':
      cutoff = now - 365 * 86_400;
      break;
    case 'all':
    default:
      cutoff = null;
      break;
  }

  // Estimate how many rows fall within the window and derive a step.
  const estimatedRows = cutoff === null ? totalRows : Math.min(totalRows, totalRows);
  const step = Math.max(1, Math.floor(estimatedRows / TARGET_POINTS));
  return { cutoff, step };
}

interface BurnedSummary {
  total_burned: number;
  burned_24h: number;
  burned_7d: number;
  burned_30d: number;
}

export default async function supplyRoutes(app: FastifyInstance) {
  // ----------------------------------------------------------------
  // GET /api/supply — Current supply overview
  // ----------------------------------------------------------------
  app.get('/api/supply', {
    schema: {
      tags: ['Supply'],
      description: 'Current supply overview including total supply, max supply, and burned fees',
      response: {
        200: {
          type: 'object',
          properties: {
            total_supply: { type: 'number' },
            max_supply: { type: 'number' },
            total_burned: { type: 'number' },
            block_reward: { type: 'number' },
            height: { type: 'integer' },
            network: { type: 'string', enum: ['mainnet', 'testnet'] },
          },
        },
      },
    },
  }, async (): Promise<SupplyInfo> => {
    return cached('supply', 15_000, () => {
    const latest = queryOne<BlockSupply>(
      'SELECT height, block_reward, fees_burned, fees_collected, total_supply FROM block_supply ORDER BY height DESC LIMIT 1',
    );

    const totalBurned = queryScalar<number>(
      'SELECT COALESCE(SUM(fees_burned), 0) FROM block_supply',
    );

    const network = (process.env.NETWORK ?? 'mainnet') as NetworkType;

    return {
      total_supply: latest?.total_supply ?? 0,
      max_supply: MAX_SUPPLY,
      total_burned: totalBurned,
      block_reward: latest?.block_reward ?? 0,
      height: latest?.height ?? 0,
      network,
    };
    }); // cached
  });

  // ----------------------------------------------------------------
  // GET /api/supply/chart — Supply chart data over time
  // ----------------------------------------------------------------
  app.get<{
    Querystring: { period?: SupplyChartPeriod };
  }>('/api/supply/chart', {
    schema: {
      tags: ['Supply'],
      description: 'Supply chart data over time, sampled to keep under ~500 points',
      querystring: {
        type: 'object',
        properties: {
          period: {
            type: 'string',
            enum: ['24h', '7d', '30d', '1y', 'all'],
            default: 'all',
          },
        },
      },
      response: {
        200: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              timestamp: { type: 'integer' },
              height: { type: 'integer' },
              total_supply: { type: 'number' },
              total_burned: { type: 'number' },
            },
          },
        },
      },
    },
  }, async (request): Promise<SupplyChartPoint[]> => {
    const period = (request.query.period ?? 'all') as SupplyChartPeriod;
    return cached(`supply:chart:${period}`, 60_000, () => {

    // Anchor chart windows to chain data time, not wall-clock time.
    const latestTimestamp = queryScalar<number>('SELECT COALESCE(MAX(timestamp), 0) FROM blocks');
    if (!latestTimestamp || latestTimestamp <= 0) {
      return [];
    }

    // Count rows in the relevant window so we can compute the sampling step.
    let countSql = 'SELECT COUNT(*) FROM block_supply';
    const countParams: unknown[] = [];

    const cutoffs: Record<string, number | null> = {
      '24h': latestTimestamp - 86_400,
      '7d': latestTimestamp - 7 * 86_400,
      '30d': latestTimestamp - 30 * 86_400,
      '1y': latestTimestamp - 365 * 86_400,
      all: null,
    };
    const cutoff = cutoffs[period] ?? null;

    if (cutoff !== null) {
      countSql += ' bs JOIN blocks b ON b.height = bs.height WHERE b.timestamp >= ?';
      countParams.push(cutoff);
    }

    const totalRows = queryScalar<number>(countSql, ...countParams);
    const TARGET_POINTS = 500;
    const step = Math.max(1, Math.floor(totalRows / TARGET_POINTS));

    // Use a CTE with window function for cumulative burned, then sample.
    let dataSql: string;
    const dataParams: unknown[] = [];

    if (cutoff !== null) {
      dataSql = `
        WITH cumulative AS (
          SELECT
            b.timestamp,
            bs.height,
            bs.total_supply,
            SUM(bs.fees_burned) OVER (ORDER BY bs.height) AS total_burned
          FROM block_supply bs
          JOIN blocks b ON b.height = bs.height
        )
        SELECT timestamp, height, total_supply, total_burned
        FROM cumulative
        WHERE timestamp >= ? AND height % ? = 0
        ORDER BY height`;
      dataParams.push(cutoff, step);
    } else {
      dataSql = `
        WITH cumulative AS (
          SELECT
            b.timestamp,
            bs.height,
            bs.total_supply,
            SUM(bs.fees_burned) OVER (ORDER BY bs.height) AS total_burned
          FROM block_supply bs
          JOIN blocks b ON b.height = bs.height
        )
        SELECT timestamp, height, total_supply, total_burned
        FROM cumulative
        WHERE height % ? = 0
        ORDER BY height`;
      dataParams.push(step);
    }

    const rows = queryAll<SupplyChartPoint>(dataSql, ...dataParams);
    return rows;
    }); // cached
  });

  // ----------------------------------------------------------------
  // GET /api/supply/block/:height — Supply data for a specific block
  // ----------------------------------------------------------------
  app.get<{
    Params: { height: string };
  }>('/api/supply/block/:height', {
    schema: {
      tags: ['Supply'],
      description: 'Supply data for a specific block height',
      params: {
        type: 'object',
        required: ['height'],
        properties: {
          height: { type: 'string', pattern: '^\\d+$' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            height: { type: 'integer' },
            block_reward: { type: 'number' },
            fees_burned: { type: 'number' },
            fees_collected: { type: 'number' },
            total_supply: { type: 'number' },
          },
        },
        404: {
          type: 'object',
          properties: {
            error: { type: 'string' },
          },
        },
      },
    },
  }, async (request, reply) => {
    const height = Number(request.params.height);
    const row = queryOne<BlockSupply>(
      'SELECT height, block_reward, fees_burned, fees_collected, total_supply FROM block_supply WHERE height = ?',
      height,
    );

    if (!row) {
      return reply.status(404).send({ error: `No supply data for block ${height}` });
    }

    return row;
  });

  // ----------------------------------------------------------------
  // GET /api/supply/burned — Burned fees summary
  // ----------------------------------------------------------------
  app.get('/api/supply/burned', {
    schema: {
      tags: ['Supply'],
      description: 'Summary of total burned fees and recent burned fees by period',
      response: {
        200: {
          type: 'object',
          properties: {
            total_burned: { type: 'number' },
            burned_24h: { type: 'number' },
            burned_7d: { type: 'number' },
            burned_30d: { type: 'number' },
          },
        },
      },
    },
  }, async (): Promise<BurnedSummary> => {
    return cached('supply:burned', 30_000, () => {
    const totalBurned = queryScalar<number>(
      'SELECT COALESCE(SUM(fees_burned), 0) FROM block_supply',
    );

    const now = Math.floor(Date.now() / 1000);

    const burned24h = queryScalar<number>(
      `SELECT COALESCE(SUM(bs.fees_burned), 0)
       FROM block_supply bs
       JOIN blocks b ON b.height = bs.height
       WHERE b.timestamp >= ?`,
      now - 86_400,
    );

    const burned7d = queryScalar<number>(
      `SELECT COALESCE(SUM(bs.fees_burned), 0)
       FROM block_supply bs
       JOIN blocks b ON b.height = bs.height
       WHERE b.timestamp >= ?`,
      now - 7 * 86_400,
    );

    const burned30d = queryScalar<number>(
      `SELECT COALESCE(SUM(bs.fees_burned), 0)
       FROM block_supply bs
       JOIN blocks b ON b.height = bs.height
       WHERE b.timestamp >= ?`,
      now - 30 * 86_400,
    );

    return {
      total_burned: totalBurned,
      burned_24h: burned24h,
      burned_7d: burned7d,
      burned_30d: burned30d,
    };
    }); // cached
  });
}
