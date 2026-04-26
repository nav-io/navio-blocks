import { FastifyInstance } from 'fastify';
import { queryAll, queryOne, queryScalar } from '../db.js';
import type { PaginatedResponse, WrappedNavcoinBurn } from '@navio-blocks/shared';

function burnsTableReady(): boolean {
  const row = queryOne<{ name: string }>(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'bsc_wnav_burns'`
  );
  return row !== undefined;
}

export default async function bridgeRoutes(app: FastifyInstance) {
  app.get<{
    Querystring: { limit?: number; offset?: number };
  }>('/api/bridge/burns', {
    schema: {
      tags: ['Bridge'],
      summary: 'wNAV (BSC) burn history',
      description:
        'wNAV → Navio bridge burns on BSC: `burnedWithNote` events whose `note` starts with `nav1` (indexed by navio-blocks)',
      querystring: {
        type: 'object',
        properties: {
          limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
          offset: { type: 'integer', minimum: 0, default: 0 },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            data: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  timestamp: { type: 'integer' },
                  amount: { type: 'string' },
                  tx_hash: { type: 'string' },
                  note: { type: 'string', nullable: true },
                  from_address: { type: 'string', nullable: true },
                },
                required: ['timestamp', 'amount', 'tx_hash'],
              },
            },
            total: { type: 'integer' },
            limit: { type: 'integer' },
            offset: { type: 'integer' },
          },
        },
      },
    },
  }, async (request): Promise<PaginatedResponse<WrappedNavcoinBurn>> => {
    const limit = request.query.limit ?? 50;
    const offset = request.query.offset ?? 0;

    if (!burnsTableReady()) {
      return { data: [], total: 0, limit, offset };
    }

    const nav1Clause =
      `WHERE LOWER(TRIM(note)) LIKE 'nav1%'`;

    const total = queryScalar<number>(
      `SELECT COUNT(*) FROM bsc_wnav_burns ${nav1Clause}`,
    );

    const rows = queryAll<{
      timestamp: number;
      amount: string;
      tx_hash: string;
      note: string | null;
      from_address: string | null;
    }>(
      `SELECT timestamp, amount, tx_hash, note, from_address
       FROM bsc_wnav_burns
       ${nav1Clause}
       ORDER BY timestamp DESC, tx_hash DESC, log_index DESC
       LIMIT ? OFFSET ?`,
      limit,
      offset,
    );

    return {
      data: rows.map((r) => ({
        timestamp: r.timestamp,
        amount: r.amount,
        tx_hash: r.tx_hash,
        note: r.note,
        from_address: r.from_address,
      })),
      total,
      limit,
      offset,
    };
  });
}
