import { FastifyInstance } from 'fastify';
import { queryAll, queryOne, queryScalar } from '../db.js';
import type {
  NetworkType,
  NavioBridgeAuditOutgoing,
  NavioBridgeAuditSummary,
  PaginatedResponse,
  WrappedNavcoinBurn,
} from '@navio-blocks/shared';
import { wnavBridgeNotePrefix } from '@navio-blocks/shared';

function burnsTableReady(): boolean {
  const row = queryOne<{ name: string }>(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'bsc_wnav_burns'`
  );
  return row !== undefined;
}

function auditTablesReady(): boolean {
  const row = queryOne<{ name: string }>(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'navio_audit_meta'`
  );
  return row !== undefined;
}

interface BridgeAuditSummaryResponse {
  indexed: boolean;
  summary: NavioBridgeAuditSummary | null;
  /** Sum of outgoing payout amounts (NAV sats), decimal string. */
  total_outgoing_sat: string;
}

export default async function bridgeRoutes(app: FastifyInstance) {
  app.get<{
    Querystring: { limit?: number; offset?: number };
  }>('/api/bridge/burns', {
    schema: {
      tags: ['Bridge'],
      summary: 'wNAV (BSC) burn history',
      description:
        'wNAV → Navio bridge burns on BSC: `burnedWithNote` events whose `note` matches the explorer network prefix (`nav1` mainnet, `tnv1` testnet by default; set `NETWORK` / `BSC_WNAV_NOTE_PREFIX`)',
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

    const network = (process.env.NETWORK ?? 'mainnet') as NetworkType;
    const notePrefix = wnavBridgeNotePrefix(network, process.env.BSC_WNAV_NOTE_PREFIX);
    const noteClause = `WHERE LOWER(TRIM(note)) LIKE ?`;
    const likeParam = `${notePrefix}%`;

    const total = queryScalar<number>(
      `SELECT COUNT(*) FROM bsc_wnav_burns ${noteClause}`,
      likeParam,
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
       ${noteClause}
       ORDER BY timestamp DESC, tx_hash DESC, log_index DESC
       LIMIT ? OFFSET ?`,
      likeParam,
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

  app.get('/api/bridge/audit/summary', {
    schema: {
      tags: ['Bridge'],
      summary: 'BLSCT audit wallet snapshot (indexed payouts)',
      description:
        'Summary from the explorer’s navio-sdk Electrum sync when `NAVIO_AUDIT_KEY` / `AUDIT_KEY` is configured on the indexer.',
      response: { 200: { type: 'object', additionalProperties: true } },
    },
  }, async (): Promise<BridgeAuditSummaryResponse> => {
    if (!auditTablesReady()) {
      return { indexed: false, summary: null, total_outgoing_sat: '0' };
    }
    const meta = queryOne<NavioBridgeAuditSummary>(
      `SELECT balance_sat, synced_height, chain_tip, error_message, updated_at FROM navio_audit_meta WHERE id = 1`
    );
    if (!meta || meta.updated_at === 0) {
      return { indexed: false, summary: meta ?? null, total_outgoing_sat: '0' };
    }
    const amounts = queryAll<{ amount_sat: string }>(
      `SELECT amount_sat FROM navio_audit_outgoing`
    );
    const totalOutgoing = amounts
      .reduce((a, r) => a + BigInt(r.amount_sat), 0n)
      .toString();
    return {
      indexed: true,
      summary: meta,
      total_outgoing_sat: totalOutgoing,
    };
  });

  app.get<{
    Querystring: { limit?: number; offset?: number };
  }>('/api/bridge/audit/outgoing', {
    schema: {
      tags: ['Bridge'],
      summary: 'Outgoing NAV payouts from the audited bridge wallet',
      querystring: {
        type: 'object',
        properties: {
          limit: { type: 'integer', minimum: 1, maximum: 500, default: 50 },
          offset: { type: 'integer', minimum: 0, default: 0 },
        },
      },
      response: { 200: { type: 'object', additionalProperties: true } },
    },
  }, async (request): Promise<PaginatedResponse<NavioBridgeAuditOutgoing>> => {
    const limit = request.query.limit ?? 50;
    const offset = request.query.offset ?? 0;

    if (!auditTablesReady()) {
      return { data: [], total: 0, limit, offset };
    }

    const total = queryScalar<number>(
      `SELECT COUNT(*) FROM navio_audit_outgoing`
    );

    const rows = queryAll<NavioBridgeAuditOutgoing>(
      `SELECT spend_tx_hash, block_height, amount_sat
       FROM navio_audit_outgoing
       ORDER BY block_height DESC, spend_tx_hash DESC
       LIMIT ? OFFSET ?`,
      limit,
      offset,
    );

    return { data: rows, total, limit, offset };
  });
}
