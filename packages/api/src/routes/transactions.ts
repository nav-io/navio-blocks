import { FastifyInstance } from 'fastify';
import { queryOne, queryAll } from '../db.js';
import { cached } from '../cache.js';
import type {
  TransactionDetail,
  Transaction,
  Input,
  Output,
  LatestOutput,
  OutputDetail,
  OutputTypeStats,
  StakingInfo,
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
  const outputType =
    typeof row.output_type === 'string'
      ? (normalizeOutputType(row.output_type, row) as Input['output_type'])
      : undefined;

  return {
    txid: String(row.txid ?? ''),
    vin: Number(row.vin ?? 0),
    prev_out: typeof row.prev_out === 'string' ? row.prev_out : '',
    is_coinbase: Boolean(row.is_coinbase),
    output_type: outputType,
  };
}

const NATIVE_TOKEN_ID = '0000000000000000000000000000000000000000000000000000000000000000';

function normalizePredicateLabel(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const normalized = raw.trim().toUpperCase();
  return normalized.length > 0 ? normalized : undefined;
}

function outputTypeFromPredicate(predicate: string | undefined): string | undefined {
  switch (predicate) {
    case 'CREATE_TOKEN':
      return 'token_create';
    case 'MINT':
    case 'MINT_TOKEN':
      return 'token_mint';
    case 'NFT_MINT':
    case 'MINT_NFT':
      return 'nft_mint';
    case 'PAY_FEE':
    case 'DATA':
      return 'fee';
    default:
      return undefined;
  }
}

// Remap legacy output_type values that no longer exist in the enum
function normalizeOutputType(raw: unknown, row?: Record<string, unknown>): string {
  const predicateType = outputTypeFromPredicate(normalizePredicateLabel(row?.predicate));
  if (predicateType) return predicateType;

  const t = typeof raw === 'string' ? raw : 'unknown';
  if (t === 'blsct' || t === 'native' || t === 'unstake' || t === 'unknown') return 'transfer';
  if (t === 'data') return 'fee';
  return t;
}

function parsePredicateArgs(raw: unknown): Record<string, unknown> | undefined {
  if (typeof raw !== 'string' || raw.trim() === '') return undefined;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function isNonTokenPredicate(predicate: string | undefined): boolean {
  if (!predicate) return false;
  const normalized = predicate.trim().toUpperCase();
  return normalized === 'PAY_FEE' || normalized === 'DATA';
}

function normalizeSpkType(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  if (raw === 'nulldata') return 'unspendable';
  return raw;
}

function sanitizeTokenIdForOutput(
  outputType: string,
  predicate: string | undefined,
  tokenId: string | undefined
): string | undefined {
  // Fee outputs and non-token predicates are native NAV only.
  if (outputType === 'fee') return undefined;
  if (isNonTokenPredicate(predicate)) return undefined;
  return tokenId;
}

function toOutput(row: Record<string, unknown>): Output {
  const spendingTxid = typeof row.spending_txid === 'string' ? row.spending_txid : null;
  const spendingVin =
    typeof row.spending_vin === 'number'
      ? row.spending_vin
      : row.spending_vin == null
        ? null
        : Number(row.spending_vin);

  const normalizedType = normalizeOutputType(row.output_type, row);
  const rawTokenId = typeof row.token_id === 'string' ? row.token_id : undefined;
  const predicate = typeof row.predicate === 'string' ? row.predicate : undefined;

  return {
    ...row,
    is_blsct: Boolean(row.is_blsct),
    spent: row.spent == null ? Boolean(spendingTxid) : Boolean(row.spent),
    spending_txid: spendingTxid,
    spending_vin: Number.isFinite(spendingVin) ? spendingVin : null,
    output_type: normalizedType,
    spk_type: normalizeSpkType(row.spk_type),
    spk_hex: typeof row.spk_hex === 'string' ? row.spk_hex : undefined,
    token_id: sanitizeTokenIdForOutput(normalizedType, predicate, rawTokenId),
    predicate,
    predicate_hex: typeof row.predicate_hex === 'string' ? row.predicate_hex : undefined,
    predicate_args: parsePredicateArgs(row.predicate_args_json),
  } as unknown as Output;
}

function toLatestOutput(row: Record<string, unknown>): LatestOutput {
  const normalizedType = normalizeOutputType(row.output_type, row);
  const rawTokenId = typeof row.token_id === 'string' ? row.token_id : undefined;
  const predicate = typeof row.predicate === 'string' ? row.predicate : undefined;

  return {
    ...row,
    is_blsct: Boolean(row.is_blsct),
    output_type: normalizedType,
    spk_type: normalizeSpkType(row.spk_type),
    spk_hex: typeof row.spk_hex === 'string' ? row.spk_hex : undefined,
    token_id: sanitizeTokenIdForOutput(normalizedType, predicate, rawTokenId),
    predicate,
    predicate_hex: typeof row.predicate_hex === 'string' ? row.predicate_hex : undefined,
    predicate_args: parsePredicateArgs(row.predicate_args_json),
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

function extractValueSatFromRawTx(rawTx: Record<string, unknown> | null, n: number): number | undefined {
  if (!rawTx || !Array.isArray(rawTx.vout)) return undefined;
  const vouts = rawTx.vout as unknown[];

  for (const item of vouts) {
    if (!item || typeof item !== 'object') continue;
    const vout = item as Record<string, unknown>;
    const rawN = vout.n;
    const voutN = typeof rawN === 'number' ? rawN : Number(rawN);
    if (!Number.isFinite(voutN) || voutN !== n) continue;

    const rawValue = vout.value;
    if (typeof rawValue === 'number' && Number.isFinite(rawValue)) {
      return Math.round(rawValue * 1e8);
    }
    return undefined;
  }

  return undefined;
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
          output_type: { type: 'string', nullable: true },
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
          output_type: { type: 'string' },
          spk_type: { type: 'string', nullable: true },
          spk_hex: { type: 'string', nullable: true },
          token_id: { type: 'string', nullable: true },
          predicate: { type: 'string', nullable: true },
          predicate_hex: { type: 'string', nullable: true },
          predicate_args: { type: 'object', nullable: true, additionalProperties: true },
          spent: { type: 'boolean' },
          spending_txid: { type: 'string', nullable: true },
          spending_vin: { type: 'integer', nullable: true },
        },
      },
    },
  },
};

const outputItemSchema = {
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
    output_type: { type: 'string' },
    spk_type: { type: 'string', nullable: true },
    spk_hex: { type: 'string', nullable: true },
    token_id: { type: 'string', nullable: true },
    predicate: { type: 'string', nullable: true },
    predicate_hex: { type: 'string', nullable: true },
    predicate_args: { type: 'object', nullable: true, additionalProperties: true },
    block_height: { type: 'integer' },
    timestamp: { type: 'integer' },
  },
};

export default async function transactionsRoutes(app: FastifyInstance) {
  // GET /api/outputs/stats — Output type distribution
  app.get<{
    Querystring: { include_coinbase?: string; period?: string };
  }>('/api/outputs/stats', {
    schema: {
      tags: ['Outputs'],
      description: 'Get output type distribution stats with optional timeframe',
      querystring: {
        type: 'object',
        properties: {
          include_coinbase: { type: 'string' },
          period: { type: 'string', enum: ['24h', '7d', '30d', '1y', 'all'] },
        },
      },
      response: {
        200: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string' },
              count: { type: 'integer' },
              percentage: { type: 'number' },
            },
          },
        },
      },
    },
  }, async (request): Promise<OutputTypeStats[]> => {
    const includeCoinbase =
      request.query.include_coinbase === '1' ||
      request.query.include_coinbase === 'true';
    const period = request.query.period ?? '30d';
    return cached(`outputs:stats:${period}:${includeCoinbase}`, 30_000, () => {

    const outputTypeCase = `CASE
           WHEN UPPER(COALESCE(o.predicate, '')) = 'CREATE_TOKEN' THEN 'token_create'
           WHEN UPPER(COALESCE(o.predicate, '')) IN ('MINT', 'MINT_TOKEN') THEN 'token_mint'
           WHEN UPPER(COALESCE(o.predicate, '')) IN ('NFT_MINT', 'MINT_NFT') THEN 'nft_mint'
           WHEN UPPER(COALESCE(o.predicate, '')) IN ('PAY_FEE', 'DATA') THEN 'fee'
           ELSE CASE COALESCE(o.output_type, 'unknown')
             WHEN 'blsct' THEN 'transfer'
             WHEN 'native' THEN 'transfer'
             WHEN 'unstake' THEN 'transfer'
             WHEN 'unknown' THEN 'transfer'
             WHEN 'data' THEN 'fee'
             ELSE COALESCE(o.output_type, 'transfer')
           END
         END`;

    const coinbaseFilter = includeCoinbase ? '' : `AND ${outputTypeCase} <> 'coinbase'`;

    if (period === 'all') {
      // Fast path: no time filter, query outputs directly
      const rows = queryAll<{ output_type: string; count: number }>(
        `SELECT ${outputTypeCase} AS output_type, COUNT(*) AS count
         FROM outputs o
         WHERE o.output_hash <> '' ${coinbaseFilter}
         GROUP BY 1
         ORDER BY count DESC`,
      );
      const total = rows.reduce((s, r) => s + r.count, 0);
      if (total === 0) return [];
      return rows.map((r) => ({
        type: r.output_type as OutputTypeStats['type'],
        count: r.count,
        percentage: Math.round((r.count / total) * 10000) / 100,
      }));
    }

    // Time-filtered: resolve cutoff timestamp → min block height, then drive from transactions
    const periodSeconds: Record<string, number> = {
      '24h': 86400,
      '7d': 604800,
      '30d': 2592000,
      '1y': 31536000,
    };
    const secs = periodSeconds[period];
    if (!secs) return [];

    const cutoff = Math.floor(Date.now() / 1000) - secs;
    const minHeightRow = queryOne<{ h: number }>(
      `SELECT COALESCE(MIN(height), 0) AS h FROM blocks WHERE timestamp >= ?`,
      cutoff,
    );
    const minHeight = minHeightRow?.h ?? 0;

    const rows = queryAll<{ output_type: string; count: number }>(
      `SELECT ${outputTypeCase} AS output_type, COUNT(*) AS count
       FROM transactions t
       JOIN outputs o ON o.txid = t.txid
       WHERE t.block_height >= ? AND o.output_hash <> '' ${coinbaseFilter}
       GROUP BY 1
       ORDER BY count DESC`,
      minHeight,
    );
    const total = rows.reduce((s, r) => s + r.count, 0);
    if (total === 0) return [];
    return rows.map((r) => ({
      type: r.output_type as OutputTypeStats['type'],
      count: r.count,
      percentage: Math.round((r.count / total) * 10000) / 100,
    }));
    }); // cached
  });

  // GET /api/staking — Staking overview
  app.get('/api/staking', {
    schema: {
      tags: ['Staking'],
      description: 'Get staking overview: active stakes, total staked, age distribution, top stakes',
      response: { 200: { type: 'object', additionalProperties: true } },
    },
  }, async (): Promise<StakingInfo> => {
    return cached('staking', 30_000, () => {
    const now = Math.floor(Date.now() / 1000);

    // Active (unspent) stake outputs
    const activeRows = queryAll<{
      output_hash: string;
      value_sat: number;
      block_height: number;
      timestamp: number;
    }>(
      `SELECT o.output_hash, o.value_sat, t.block_height, b.timestamp
       FROM outputs o
       JOIN transactions t ON t.txid = o.txid
       JOIN blocks b ON b.height = t.block_height
       LEFT JOIN inputs i ON i.prev_out = o.output_hash AND COALESCE(i.prev_out, '') <> ''
       WHERE o.output_type = 'stake'
         AND i.prev_out IS NULL
       ORDER BY b.timestamp DESC`,
    );

    // Total ever staked (including spent)
    const totalEverRow = queryOne<{ count: number }>(
      `SELECT COUNT(*) AS count FROM outputs WHERE output_type = 'stake'`,
    );

    const activeStakes = activeRows.length;
    const totalStakedSat = activeRows.reduce((sum, r) => sum + (r.value_sat ?? 0), 0);
    const totalEverStaked = totalEverRow?.count ?? 0;

    let avgStakeAge = 0;
    let oldestTs = 0;
    let newestTs = 0;
    if (activeRows.length > 0) {
      const ages = activeRows.map((r) => now - r.timestamp);
      avgStakeAge = Math.round(ages.reduce((a, b) => a + b, 0) / ages.length);
      oldestTs = Math.min(...activeRows.map((r) => r.timestamp));
      newestTs = Math.max(...activeRows.map((r) => r.timestamp));
    }

    // Value distribution buckets
    const buckets = [
      { label: '< 100 NAV', max: 100e8 },
      { label: '100-1K NAV', max: 1000e8 },
      { label: '1K-10K NAV', max: 10000e8 },
      { label: '10K-100K NAV', max: 100000e8 },
      { label: '100K+ NAV', max: Infinity },
    ];
    const bucketCounts = buckets.map((b) => ({ bucket: b.label, count: 0 }));
    for (const r of activeRows) {
      const val = r.value_sat ?? 0;
      let prev = 0;
      for (let i = 0; i < buckets.length; i++) {
        if (val > prev && val <= buckets[i].max) {
          bucketCounts[i].count++;
          break;
        }
        prev = buckets[i].max;
      }
    }

    // Top 10 largest active stakes
    const topStakes = activeRows
      .sort((a, b) => (b.value_sat ?? 0) - (a.value_sat ?? 0))
      .slice(0, 10)
      .map((r) => ({
        output_hash: r.output_hash,
        value_sat: r.value_sat ?? 0,
        block_height: r.block_height,
        timestamp: r.timestamp,
        age_seconds: now - r.timestamp,
      }));

    return {
      active_stakes: activeStakes,
      total_staked_sat: totalStakedSat,
      total_ever_staked: totalEverStaked,
      avg_stake_age_seconds: avgStakeAge,
      oldest_stake_timestamp: oldestTs,
      newest_stake_timestamp: newestTs,
      stake_value_distribution: bucketCounts,
      top_stakes: topStakes,
    };
    }); // cached
  });

  // GET /api/outputs/:hash — Output detail
  app.get<{
    Params: { hash: string };
  }>('/api/outputs/:hash', {
    schema: {
      tags: ['Outputs'],
      description: 'Get output detail by output hash',
      params: {
        type: 'object',
        required: ['hash'],
        properties: { hash: { type: 'string' } },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            ...outputItemSchema.properties,
            spent: { type: 'boolean' },
            spending_txid: { type: 'string', nullable: true },
            spending_vin: { type: 'integer', nullable: true },
            is_coinbase_tx: { type: 'boolean' },
          },
        },
        404: {
          type: 'object',
          properties: { error: { type: 'string' } },
        },
      },
    },
  }, async (request, reply) => {
    const hash = request.params.hash.trim();

    const row = queryOne<Record<string, unknown>>(
      `SELECT
         o.*,
         t.block_height,
         t.is_coinbase AS is_coinbase_tx,
         t.raw_json AS tx_raw_json,
         b.timestamp
       FROM outputs o
       JOIN transactions t ON t.txid = o.txid
       JOIN blocks b ON b.height = t.block_height
       WHERE LOWER(o.output_hash) = LOWER(?)`,
      hash,
    );

    if (!row) {
      return reply.status(404).send({ error: 'Output not found' });
    }

    // Look up spending info
    const spendRow = queryOne<{ spending_txid: string; spending_vin: number }>(
      `SELECT i.txid AS spending_txid, i.vin AS spending_vin
       FROM inputs i
       WHERE i.prev_out = ?
       LIMIT 1`,
      row.output_hash as string,
    );

    const txRaw = parseRawTx({ raw_json: row.tx_raw_json });
    const { tx_raw_json: _txRawJson, ...outputRow } = row;

    const normalizedOutput = toOutput({
      ...outputRow,
      spending_txid: spendRow?.spending_txid ?? null,
      spending_vin: spendRow?.spending_vin ?? null,
    });
    const valueSat = normalizedOutput.value_sat ?? extractValueSatFromRawTx(txRaw, normalizedOutput.n);

    const result: OutputDetail = {
      ...normalizedOutput,
      value_sat: valueSat,
      block_height: row.block_height as number,
      timestamp: row.timestamp as number,
      is_coinbase_tx: Boolean(row.is_coinbase_tx),
    };

    return result;
  });

  // GET /api/outputs — Outputs list with filtering
  app.get<{
    Querystring: { limit?: number; offset?: number; type?: string; token_id?: string; is_nft?: string; token_mode?: string; all?: string; spent?: string };
  }>('/api/outputs', {
    schema: {
      tags: ['Outputs'],
      description: 'Get outputs with optional type, token, and spent filters',
      querystring: {
        type: 'object',
        properties: {
          limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
          offset: { type: 'integer', minimum: 0, default: 0 },
          type: { type: 'string' },
          token_id: { type: 'string' },
          is_nft: { type: 'string' },
          token_mode: { type: 'string', enum: ['nav', 'tokens', 'nfts'], description: 'nav = native NAV only, tokens = fungible tokens, nfts = NFTs' },
          all: { type: 'string' },
          spent: { type: 'string', enum: ['1', '0'], description: '1 = spent only, 0 = unspent only' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            data: { type: 'array', items: outputItemSchema },
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
    const typeFilter = request.query.type;
    const tokenIdFilter = request.query.token_id;
    const isNft = request.query.is_nft === '1';
    const tokenMode = request.query.token_mode;
    const showAll = request.query.all === '1';
    const spentFilter = request.query.spent;

    const effectiveOutputTypeExpr = `CASE
      WHEN UPPER(COALESCE(o.predicate, '')) = 'CREATE_TOKEN' THEN 'token_create'
      WHEN UPPER(COALESCE(o.predicate, '')) IN ('MINT', 'MINT_TOKEN') THEN 'token_mint'
      WHEN UPPER(COALESCE(o.predicate, '')) IN ('NFT_MINT', 'MINT_NFT') THEN 'nft_mint'
      WHEN UPPER(COALESCE(o.predicate, '')) IN ('PAY_FEE', 'DATA') THEN 'fee'
      ELSE CASE COALESCE(o.output_type, 'unknown')
        WHEN 'blsct' THEN 'transfer'
        WHEN 'native' THEN 'transfer'
        WHEN 'unstake' THEN 'transfer'
        WHEN 'unknown' THEN 'transfer'
        WHEN 'data' THEN 'fee'
        ELSE COALESCE(o.output_type, 'transfer')
      END
    END`;

    const conditions: string[] = [`COALESCE(o.output_hash, '') <> ''`];
    const params: unknown[] = [];

    if (!showAll) {
      conditions.push(`${effectiveOutputTypeExpr} NOT IN ('coinbase', 'fee')`);
    }

    if (typeFilter) {
      conditions.push(`${effectiveOutputTypeExpr} = ?`);
      params.push(typeFilter);
    }

    if (tokenIdFilter) {
      conditions.push(`o.token_id = ?`);
      conditions.push(`COALESCE(UPPER(o.predicate), '') NOT IN ('PAY_FEE', 'DATA')`);
      params.push(tokenIdFilter);
    }

    if (isNft) {
      conditions.push(`o.token_id LIKE '%#%'`);
      conditions.push(`COALESCE(UPPER(o.predicate), '') NOT IN ('PAY_FEE', 'DATA')`);
    }

    // Token mode filter: nav = native coin, tokens = fungible tokens, nfts = NFTs
    if (tokenMode === 'nav') {
      conditions.push(`(o.token_id IS NULL OR o.token_id = '${NATIVE_TOKEN_ID}')`);
    } else if (tokenMode === 'tokens') {
      conditions.push(`o.token_id IS NOT NULL AND o.token_id <> '${NATIVE_TOKEN_ID}' AND o.token_id NOT LIKE '%#%'`);
      conditions.push(`COALESCE(UPPER(o.predicate), '') NOT IN ('PAY_FEE', 'DATA')`);
    } else if (tokenMode === 'nfts') {
      conditions.push(`o.token_id LIKE '%#%'`);
      conditions.push(`COALESCE(UPPER(o.predicate), '') NOT IN ('PAY_FEE', 'DATA')`);
    }

    // Spent filter using EXISTS subquery (no duplicate risk)
    if (spentFilter === '1') {
      conditions.push(`EXISTS (SELECT 1 FROM inputs i2 WHERE i2.prev_out = o.output_hash AND i2.prev_out <> '')`);
    } else if (spentFilter === '0') {
      conditions.push(`NOT EXISTS (SELECT 1 FROM inputs i2 WHERE i2.prev_out = o.output_hash AND i2.prev_out <> '')`);
    }

    const whereClause = conditions.join(' AND ');

    const rows = queryAll<Record<string, unknown>>(
      `SELECT
         o.output_hash, o.txid, o.n, o.value_sat, o.address,
         o.spending_key, o.ephemeral_key, o.blinding_key, o.view_tag,
         o.is_blsct, o.output_type, o.spk_type, o.spk_hex, o.token_id,
         o.predicate, o.predicate_hex, o.predicate_args_json,
         t.block_height, b.timestamp, t.raw_json AS tx_raw_json
       FROM outputs o
       JOIN transactions t ON t.txid = o.txid
       JOIN blocks b ON b.height = t.block_height
       WHERE ${whereClause}
       ORDER BY t.block_height DESC, t.tx_index DESC, o.n ASC
       LIMIT ? OFFSET ?`,
      ...params,
      limit,
      offset,
    );

    const total = queryOne<{ count: number }>(
      `SELECT COUNT(*) AS count
       FROM outputs o
       JOIN transactions t ON t.txid = o.txid
       WHERE ${whereClause}`,
      ...params,
    )?.count ?? 0;

    return {
      data: rows.map((row) => {
        const { tx_raw_json: txRawJson, ...outputRow } = row;
        const out = toLatestOutput(outputRow);
        const rawTx = parseRawTx({ raw_json: txRawJson });
        const valueSat = out.value_sat ?? extractValueSatFromRawTx(rawTx, out.n);
        return {
          ...out,
          value_sat: valueSat,
        };
      }),
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
      `SELECT
         i.txid,
         i.vin,
         i.prev_out,
         i.is_coinbase,
         o.output_type
       FROM inputs i
       LEFT JOIN outputs o ON o.output_hash = i.prev_out
       WHERE i.txid = ?
       ORDER BY i.vin`,
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

    const resolveOutputTypeByHash = (outputHash: string): Input['output_type'] | undefined => {
      const row = queryOne<{ output_type: string; predicate: string | null }>(
        'SELECT output_type, predicate FROM outputs WHERE output_hash = ?',
        outputHash,
      );
      if (typeof row?.output_type !== 'string') return undefined;
      return normalizeOutputType(row.output_type, row as unknown as Record<string, unknown>) as Input['output_type'];
    };

    const rawVins = Array.isArray(naviodTx?.vin)
      ? (naviodTx?.vin as Record<string, unknown>[])
      : [];

    const normalizedInputs = inputRows.map((row, index) => {
      const input = toInput(row);
      if (input.is_coinbase || input.prev_out) return input;

      const prevOut = extractPrevOutFromRawVin(rawVins[index], resolveOutputHashByTxN);
      const outputType = prevOut ? resolveOutputTypeByHash(prevOut) : undefined;
      return {
        ...input,
        prev_out: prevOut,
        output_type: outputType ?? input.output_type,
      };
    });

    const detail: TransactionDetail = {
      ...tx,
      inputs: normalizedInputs,
      outputs: outputRows.map((row) => {
        const out = toOutput(row);
        const valueSat = out.value_sat ?? extractValueSatFromRawTx(naviodTx, out.n);
        const spend = out.output_hash ? spentByOutput.get(out.output_hash) : undefined;
        return {
          ...out,
          value_sat: valueSat,
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
