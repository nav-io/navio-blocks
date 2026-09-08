import { FastifyInstance } from 'fastify';
import { queryOne, queryAll } from '../db.js';
import { currentNetwork } from '../context.js';
import type {
  P2pmsgSummary,
  P2pmsgHistoryPoint,
  P2pmsgTrading,
  ChartPeriod,
} from '@navio-blocks/shared';

interface P2pmsgRow {
  timestamp: number;
  network: string;
  enabled: number;
  relay_capable_peers: number;
  total_peers: number;
  agg_available: number;
  agg_extra_fee_per_candidate: number;
  orders_count: number;
  orders_bytes: number;
  rfqs_count: number;
  pings_received: number;
  identity_pubkey: string | null;
  inbox_pubkey: string | null;
}

/** True when the p2pmsg_stats table exists (older DBs may predate it). */
function tableExists(): boolean {
  try {
    const row = queryOne<{ n: number }>(
      `SELECT COUNT(*) AS n FROM sqlite_master
       WHERE type = 'table' AND name = 'p2pmsg_stats'`,
    );
    return (row?.n ?? 0) > 0;
  } catch {
    return false;
  }
}

function capablePct(relayCapable: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((relayCapable / total) * 10000) / 100;
}

/** Payload returned when the overlay has never reported / no data exists. */
function disabledSummary(): P2pmsgSummary {
  return {
    enabled: false,
    timestamp: null,
    relay_capable_peers: 0,
    total_peers: 0,
    capable_pct: 0,
    agg_available: 0,
    agg_extra_fee_per_candidate: 0,
    pings_received: 0,
    identity_pubkey: null,
    inbox_pubkey: null,
    relay_capable_peers_24h: null,
    capable_pct_24h: null,
    agg_available_24h: null,
  };
}

function disabledTrading(): P2pmsgTrading {
  return {
    enabled: false,
    timestamp: null,
    orders_count: 0,
    orders_bytes: 0,
    rfqs_count: 0,
  };
}

/** Sampling window + bucket size for a chart period (mirrors the price route). */
function samplingInterval(period: ChartPeriod): { cutoff: number; interval: number } {
  const now = Math.floor(Date.now() / 1000);
  switch (period) {
    case '24h':
      return { cutoff: now - 86400, interval: 300 };          // every 5 min
    case '7d':
      return { cutoff: now - 7 * 86400, interval: 3600 };     // every hour
    case '30d':
      return { cutoff: now - 30 * 86400, interval: 14400 };   // every 4 hours
    case '1y':
      return { cutoff: now - 365 * 86400, interval: 86400 };  // daily
    default:
      return { cutoff: now - 86400, interval: 300 };
  }
}

export default async function p2pmsgRoutes(app: FastifyInstance) {
  // GET /api/p2pmsg/summary — latest overlay snapshot + derived adoption %.
  app.get('/p2pmsg/summary', {
    schema: {
      tags: ['P2pmsg'],
      description:
        'Latest p2pmsg / P2P overlay snapshot with derived relay-capable % and 24h trend anchors',
      response: {
        200: {
          type: 'object',
          properties: {
            enabled: { type: 'boolean' },
            timestamp: { type: 'integer', nullable: true },
            relay_capable_peers: { type: 'integer' },
            total_peers: { type: 'integer' },
            capable_pct: { type: 'number' },
            agg_available: { type: 'integer' },
            agg_extra_fee_per_candidate: { type: 'integer' },
            pings_received: { type: 'integer' },
            identity_pubkey: { type: 'string', nullable: true },
            inbox_pubkey: { type: 'string', nullable: true },
            relay_capable_peers_24h: { type: 'integer', nullable: true },
            capable_pct_24h: { type: 'number', nullable: true },
            agg_available_24h: { type: 'number', nullable: true },
          },
        },
      },
    },
  }, async (): Promise<P2pmsgSummary> => {
    if (!tableExists()) return disabledSummary();
    const network = currentNetwork();

    const latest = queryOne<P2pmsgRow>(
      `SELECT * FROM p2pmsg_stats WHERE network = ? ORDER BY timestamp DESC LIMIT 1`,
      network,
    );
    if (!latest) return disabledSummary();

    const dayAgo = queryOne<P2pmsgRow>(
      `SELECT * FROM p2pmsg_stats
       WHERE network = ? AND timestamp <= ?
       ORDER BY timestamp DESC LIMIT 1`,
      network,
      latest.timestamp - 86400,
    );

    return {
      enabled: latest.enabled === 1,
      timestamp: latest.timestamp,
      relay_capable_peers: latest.relay_capable_peers,
      total_peers: latest.total_peers,
      capable_pct: capablePct(latest.relay_capable_peers, latest.total_peers),
      agg_available: latest.agg_available,
      agg_extra_fee_per_candidate: latest.agg_extra_fee_per_candidate,
      pings_received: latest.pings_received,
      identity_pubkey: latest.identity_pubkey,
      inbox_pubkey: latest.inbox_pubkey,
      relay_capable_peers_24h: dayAgo ? dayAgo.relay_capable_peers : null,
      capable_pct_24h: dayAgo
        ? capablePct(dayAgo.relay_capable_peers, dayAgo.total_peers)
        : null,
      agg_available_24h: dayAgo ? dayAgo.agg_available : null,
    };
  });

  // GET /api/p2pmsg/history — bucketed series for charts.
  app.get<{
    Querystring: { period?: ChartPeriod };
  }>('/p2pmsg/history', {
    schema: {
      tags: ['P2pmsg'],
      description: 'Historical p2pmsg overlay stats for charting',
      querystring: {
        type: 'object',
        properties: {
          period: { type: 'string', enum: ['24h', '7d', '30d', '1y'], default: '7d' },
        },
      },
      response: {
        200: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              timestamp: { type: 'integer' },
              relay_capable_peers: { type: 'integer' },
              total_peers: { type: 'integer' },
              capable_pct: { type: 'number' },
              agg_available: { type: 'integer' },
              orders_count: { type: 'integer' },
              rfqs_count: { type: 'integer' },
            },
          },
        },
      },
    },
  }, async (request): Promise<P2pmsgHistoryPoint[]> => {
    if (!tableExists()) return [];
    const network = currentNetwork();
    const period = (request.query.period ?? '7d') as ChartPeriod;
    const { cutoff, interval } = samplingInterval(period);

    const rows = queryAll<{
      timestamp: number;
      relay_capable_peers: number;
      total_peers: number;
      agg_available: number;
      orders_count: number;
      rfqs_count: number;
    }>(
      `SELECT
        (timestamp / CAST(? AS INTEGER)) * CAST(? AS INTEGER) AS timestamp,
        AVG(relay_capable_peers) AS relay_capable_peers,
        AVG(total_peers) AS total_peers,
        AVG(agg_available) AS agg_available,
        AVG(orders_count) AS orders_count,
        AVG(rfqs_count) AS rfqs_count
      FROM p2pmsg_stats
      WHERE network = ? AND timestamp >= ?
      GROUP BY timestamp / CAST(? AS INTEGER)
      ORDER BY timestamp`,
      interval,
      interval,
      network,
      cutoff,
      interval,
    );

    return rows.map((r) => ({
      timestamp: r.timestamp,
      relay_capable_peers: Math.round(r.relay_capable_peers),
      total_peers: Math.round(r.total_peers),
      capable_pct: capablePct(r.relay_capable_peers, r.total_peers),
      agg_available: Math.round(r.agg_available),
      orders_count: Math.round(r.orders_count),
      rfqs_count: Math.round(r.rfqs_count),
    }));
  });

  // GET /api/p2pmsg/trading — latest decentralized OTC / RFQ liquidity counts.
  app.get('/p2pmsg/trading', {
    schema: {
      tags: ['P2pmsg'],
      description:
        'Latest decentralized OTC / RFQ liquidity counts (aggregate only; individual orders stay private)',
      response: {
        200: {
          type: 'object',
          properties: {
            enabled: { type: 'boolean' },
            timestamp: { type: 'integer', nullable: true },
            orders_count: { type: 'integer' },
            orders_bytes: { type: 'integer' },
            rfqs_count: { type: 'integer' },
          },
        },
      },
    },
  }, async (): Promise<P2pmsgTrading> => {
    if (!tableExists()) return disabledTrading();
    const network = currentNetwork();

    const latest = queryOne<P2pmsgRow>(
      `SELECT * FROM p2pmsg_stats WHERE network = ? ORDER BY timestamp DESC LIMIT 1`,
      network,
    );
    if (!latest) return disabledTrading();

    return {
      enabled: latest.enabled === 1,
      timestamp: latest.timestamp,
      orders_count: latest.orders_count,
      orders_bytes: latest.orders_bytes,
      rfqs_count: latest.rfqs_count,
    };
  });
}
