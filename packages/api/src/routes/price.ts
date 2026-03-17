import { FastifyInstance } from 'fastify';
import { queryOne, queryAll } from '../db.js';
import type { PriceData, PriceHistoryPoint, ChartPeriod } from '@navio-blocks/shared';

interface PriceRow {
  price_usd: number;
  price_btc: number;
  volume_24h: number;
  market_cap: number;
  timestamp: number;
}

/** Get the sampling interval in seconds for a chart period. */
function samplingInterval(period: ChartPeriod): { cutoff: number; interval: number } {
  const now = Math.floor(Date.now() / 1000);
  switch (period) {
    case '24h':
      return { cutoff: now - 86400, interval: 300 };           // every 5 min
    case '7d':
      return { cutoff: now - 7 * 86400, interval: 3600 };      // every hour
    case '30d':
      return { cutoff: now - 30 * 86400, interval: 14400 };    // every 4 hours
    case '1y':
      return { cutoff: now - 365 * 86400, interval: 86400 };   // daily
    default:
      return { cutoff: now - 86400, interval: 300 };
  }
}

export default async function priceRoutes(app: FastifyInstance) {
  // GET /api/price — Current price with 24h change
  app.get('/api/price', {
    schema: {
      tags: ['Price'],
      description: 'Current NAV price with 24h change percentage',
      response: {
        200: {
          type: 'object',
          properties: {
            price_usd: { type: 'number' },
            price_btc: { type: 'number' },
            change_24h_pct: { type: 'number' },
            volume_24h: { type: 'number' },
            market_cap: { type: 'number' },
            timestamp: { type: 'integer' },
          },
        },
        404: {
          type: 'object',
          properties: { error: { type: 'string' } },
        },
      },
    },
  }, async (_request, reply) => {
    const latest = queryOne<PriceRow>(
      'SELECT * FROM price_history ORDER BY timestamp DESC LIMIT 1',
    );

    if (!latest) {
      return reply.status(404).send({ error: 'No price data available' });
    }

    // Find the price entry closest to 24 hours ago
    const oneDayAgo = latest.timestamp - 86400;
    const dayAgo = queryOne<PriceRow>(
      `SELECT * FROM price_history
       WHERE timestamp <= ?
       ORDER BY timestamp DESC
       LIMIT 1`,
      oneDayAgo,
    );

    let change24hPct = 0;
    if (dayAgo && dayAgo.price_usd > 0) {
      change24hPct = ((latest.price_usd - dayAgo.price_usd) / dayAgo.price_usd) * 100;
    }

    const result: PriceData = {
      price_usd: latest.price_usd,
      price_btc: latest.price_btc,
      change_24h_pct: Math.round(change24hPct * 100) / 100,
      volume_24h: latest.volume_24h,
      market_cap: latest.market_cap,
      timestamp: latest.timestamp,
    };

    return result;
  });

  // GET /api/price/history — Historical price data
  app.get<{
    Querystring: { period?: ChartPeriod };
  }>('/api/price/history', {
    schema: {
      tags: ['Price'],
      description: 'Historical price data for charting',
      querystring: {
        type: 'object',
        properties: {
          period: { type: 'string', enum: ['24h', '7d', '30d', '1y'], default: '24h' },
        },
      },
      response: {
        200: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              timestamp: { type: 'integer' },
              price_usd: { type: 'number' },
              price_btc: { type: 'number' },
              volume_24h: { type: 'number' },
              market_cap: { type: 'number' },
            },
          },
        },
      },
    },
  }, async (request): Promise<PriceHistoryPoint[]> => {
    const period = (request.query.period ?? '24h') as ChartPeriod;
    const { cutoff, interval } = samplingInterval(period);

    // Group by time bucket and take the last entry in each bucket
    const rows = queryAll<PriceRow>(
      `SELECT
        (timestamp / ?) * ? AS timestamp,
        AVG(price_usd) AS price_usd,
        AVG(price_btc) AS price_btc,
        AVG(volume_24h) AS volume_24h,
        AVG(market_cap) AS market_cap
      FROM price_history
      WHERE timestamp >= ?
      GROUP BY timestamp / ?
      ORDER BY timestamp`,
      interval,
      interval,
      cutoff,
      interval,
    );

    return rows.map((r) => ({
      timestamp: r.timestamp,
      price_usd: Math.round(r.price_usd * 1e8) / 1e8,
      price_btc: Math.round(r.price_btc * 1e8) / 1e8,
      volume_24h: Math.round(r.volume_24h * 100) / 100,
      market_cap: Math.round(r.market_cap * 100) / 100,
    }));
  });
}
