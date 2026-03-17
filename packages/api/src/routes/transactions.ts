import { FastifyInstance } from 'fastify';
import { queryOne, queryAll } from '../db.js';
import type {
  TransactionDetail,
  Transaction,
  Input,
  Output,
  LatestOutput,
  PaginatedResponse,
} from '@navio-blocks/shared';

function toTransaction(row: Record<string, unknown>): Transaction {
  return {
    ...row,
    is_coinbase: Boolean(row.is_coinbase),
    is_blsct: Boolean(row.is_blsct),
    has_token: Boolean(row.has_token),
  } as unknown as Transaction;
}

function toInput(row: Record<string, unknown>): Input {
  return {
    txid: String(row.txid ?? ''),
    vin: Number(row.vin ?? 0),
    prev_out: typeof row.prev_out === 'string' ? row.prev_out : '',
    is_coinbase: Boolean(row.is_coinbase),
  };
}

function toOutput(row: Record<string, unknown>): Output {
  const spendingTxid = typeof row.spending_txid === 'string' ? row.spending_txid : null;
  const spendingVin =
    typeof row.spending_vin === 'number'
      ? row.spending_vin
      : row.spending_vin == null
        ? null
        : Number(row.spending_vin);

  return {
    ...row,
    is_blsct: Boolean(row.is_blsct),
    spent: row.spent == null ? Boolean(spendingTxid) : Boolean(row.spent),
    spending_txid: spendingTxid,
    spending_vin: Number.isFinite(spendingVin) ? spendingVin : null,
  } as unknown as Output;
}

function toLatestOutput(row: Record<string, unknown>): LatestOutput {
  return {
    ...row,
    is_blsct: Boolean(row.is_blsct),
  } as unknown as LatestOutput;
}

function parseRawTx(row: Record<string, unknown>): Record<string, unknown> | null {
  const raw = row.raw_json;
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function candidateString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function extractPrevOutFromRawVin(
  vin: Record<string, unknown> | undefined,
  resolveOutputHashByTxN: (txid: string, n: number) => string | undefined,
): string {
  if (!vin) return '';

  const outpointObj = vin.outpoint as Record<string, unknown> | undefined;
  const prevoutObj = vin.prevout as Record<string, unknown> | undefined;

  const directCandidates: unknown[] = [
    vin.outid,
    vin.outId,
    vin.out_id,
    vin.output_hash,
    vin.outpoint,
    vin.prev_out,
    vin.prevout,
    vin.hash,
    outpointObj?.output_hash,
    outpointObj?.hash,
    prevoutObj?.output_hash,
    prevoutObj?.hash,
    prevoutObj?.outpoint,
  ];

  for (const candidate of directCandidates) {
    const parsed = candidateString(candidate);
    if (parsed) return parsed;
  }

  const prevTxid = candidateString(vin.txid);
  const prevVout = vin.vout;
  if (prevTxid && typeof prevVout === 'number') {
    const resolved = resolveOutputHashByTxN(prevTxid, prevVout);
    if (resolved) return resolved;
  }

  return '';
}

const txResponseSchema = {
  type: 'object',
  properties: {
    txid: { type: 'string' },
    block_height: { type: 'integer' },
    tx_index: { type: 'integer' },
    version: { type: 'integer' },
    size: { type: 'integer' },
    vsize: { type: 'integer' },
    locktime: { type: 'integer' },
    is_coinbase: { type: 'boolean' },
    is_blsct: { type: 'boolean' },
    input_count: { type: 'integer' },
    output_count: { type: 'integer' },
    has_token: { type: 'boolean' },
    naviod_tx: { type: 'object', nullable: true, additionalProperties: true },
    inputs: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          txid: { type: 'string' },
          vin: { type: 'integer' },
          prev_out: { type: 'string' },
          is_coinbase: { type: 'boolean' },
        },
      },
    },
    outputs: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          output_hash: { type: 'string' },
          txid: { type: 'string' },
          n: { type: 'integer' },
          value_sat: { type: 'integer', nullable: true },
          address: { type: 'string', nullable: true },
          spending_key: { type: 'string', nullable: true },
          ephemeral_key: { type: 'string', nullable: true },
          blinding_key: { type: 'string', nullable: true },
          view_tag: { type: 'string', nullable: true },
          is_blsct: { type: 'boolean' },
          spent: { type: 'boolean' },
          spending_txid: { type: 'string', nullable: true },
          spending_vin: { type: 'integer', nullable: true },
        },
      },
    },
  },
};

export default async function transactionsRoutes(app: FastifyInstance) {
  // GET /api/outputs — Latest non-coinbase, non-fee outputs
  app.get<{
    Querystring: { limit?: number; offset?: number };
  }>('/api/outputs', {
    schema: {
      tags: ['Transactions'],
      description: 'Get latest outputs excluding coinbase transaction outputs and fee outputs',
      querystring: {
        type: 'object',
        properties: {
          limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
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
                  output_hash: { type: 'string' },
                  txid: { type: 'string' },
                  n: { type: 'integer' },
                  value_sat: { type: 'integer', nullable: true },
                  address: { type: 'string', nullable: true },
                  spending_key: { type: 'string', nullable: true },
                  ephemeral_key: { type: 'string', nullable: true },
                  blinding_key: { type: 'string', nullable: true },
                  view_tag: { type: 'string', nullable: true },
                  is_blsct: { type: 'boolean' },
                  block_height: { type: 'integer' },
                  timestamp: { type: 'integer' },
                },
              },
            },
            total: { type: 'integer' },
            limit: { type: 'integer' },
            offset: { type: 'integer' },
          },
        },
      },
    },
  }, async (request): Promise<PaginatedResponse<LatestOutput>> => {
    const limit = Math.min(Math.max(Number(request.query.limit) || 20, 1), 100);
    const offset = Math.max(Number(request.query.offset) || 0, 0);

    const whereClause = `
      t.is_coinbase = 0
      AND NOT (
        o.is_blsct = 0
        AND COALESCE(o.value_sat, 0) > 0
      )
      AND COALESCE(o.output_hash, '') <> ''
    `;

    const rows = queryAll<Record<string, unknown>>(
      `SELECT
         o.output_hash,
         o.txid,
         o.n,
         o.value_sat,
         o.address,
         o.spending_key,
         o.ephemeral_key,
         o.blinding_key,
         o.view_tag,
         o.is_blsct,
         t.block_height,
         b.timestamp
       FROM outputs o
       JOIN transactions t ON t.txid = o.txid
       JOIN blocks b ON b.height = t.block_height
       WHERE ${whereClause}
       ORDER BY t.block_height DESC, t.tx_index DESC, o.n ASC
       LIMIT ? OFFSET ?`,
      limit,
      offset,
    );

    const total = queryOne<{ count: number }>(
      `SELECT COUNT(*) AS count
       FROM outputs o
       JOIN transactions t ON t.txid = o.txid
       WHERE ${whereClause}`,
    )?.count ?? 0;

    return {
      data: rows.map(toLatestOutput),
      total,
      limit,
      offset,
    };
  });

  // GET /api/txs/:txidOrOutput — Transaction detail with inputs and outputs
  app.get<{
    Params: { txidOrOutput: string };
  }>('/api/txs/:txidOrOutput', {
    schema: {
      tags: ['Transactions'],
      description: 'Get transaction details including inputs and outputs',
      params: {
        type: 'object',
        required: ['txidOrOutput'],
        properties: {
          txidOrOutput: { type: 'string' },
        },
      },
      response: {
        200: txResponseSchema,
        404: {
          type: 'object',
          properties: { error: { type: 'string' } },
        },
      },
    },
  }, async (request, reply) => {
    const { txidOrOutput } = request.params;
    const needle = txidOrOutput.trim();

    let txRow = queryOne<Record<string, unknown>>(
      'SELECT * FROM transactions WHERE LOWER(txid) = LOWER(?)',
      needle,
    );

    if (!txRow && /^[0-9a-fA-F]{64}$/.test(needle)) {
      txRow = queryOne<Record<string, unknown>>(
        `SELECT t.*
         FROM outputs o
         JOIN transactions t ON t.txid = o.txid
         WHERE LOWER(o.output_hash) = LOWER(?)`,
        needle,
      );
    }

    if (!txRow) {
      return reply.status(404).send({ error: 'Transaction not found' });
    }

    const tx = toTransaction(txRow);

    const inputRows = queryAll<Record<string, unknown>>(
      'SELECT * FROM inputs WHERE txid = ? ORDER BY vin',
      tx.txid,
    );

    const outputRows = queryAll<Record<string, unknown>>(
      'SELECT * FROM outputs WHERE txid = ? ORDER BY n',
      tx.txid,
    );

    const spentRows = queryAll<Record<string, unknown>>(
      `SELECT
         i.prev_out,
         i.txid AS spending_txid,
         i.vin AS spending_vin
       FROM outputs o
       JOIN inputs i ON i.prev_out = o.output_hash
       WHERE o.txid = ?
         AND COALESCE(o.output_hash, '') <> ''
         AND COALESCE(i.prev_out, '') <> ''`,
      tx.txid,
    );

    const spentByOutput = new Map<string, { spending_txid: string; spending_vin: number }>();
    for (const row of spentRows) {
      const prevOut = candidateString(row.prev_out);
      const spendingTxid = candidateString(row.spending_txid);
      const spendingVinRaw = row.spending_vin;
      const spendingVin =
        typeof spendingVinRaw === 'number' ? spendingVinRaw : Number(spendingVinRaw);

      if (!prevOut || !spendingTxid || !Number.isFinite(spendingVin)) continue;
      if (!spentByOutput.has(prevOut)) {
        spentByOutput.set(prevOut, {
          spending_txid: spendingTxid,
          spending_vin: spendingVin,
        });
      }
    }

    const naviodTx = parseRawTx(txRow);

    const resolveOutputHashByTxN = (prevTxid: string, n: number): string | undefined => {
      return queryOne<{ output_hash: string }>(
        'SELECT output_hash FROM outputs WHERE LOWER(txid) = LOWER(?) AND n = ?',
        prevTxid,
        n,
      )?.output_hash;
    };

    const rawVins = Array.isArray(naviodTx?.vin)
      ? (naviodTx?.vin as Record<string, unknown>[])
      : [];

    const normalizedInputs = inputRows.map((row, index) => {
      const input = toInput(row);
      if (input.is_coinbase || input.prev_out) return input;

      const prevOut = extractPrevOutFromRawVin(rawVins[index], resolveOutputHashByTxN);
      return {
        ...input,
        prev_out: prevOut,
      };
    });

    const detail: TransactionDetail = {
      ...tx,
      inputs: normalizedInputs,
      outputs: outputRows.map((row) => {
        const out = toOutput(row);
        const spend = out.output_hash ? spentByOutput.get(out.output_hash) : undefined;
        return {
          ...out,
          spent: Boolean(spend),
          spending_txid: spend?.spending_txid ?? null,
          spending_vin: spend?.spending_vin ?? null,
        };
      }),
      naviod_tx: naviodTx,
    };

    return detail;
  });
}
