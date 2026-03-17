import { FastifyInstance } from 'fastify';
import { queryOne, queryAll, queryScalar } from '../db.js';
import type { Block, Transaction, PaginatedResponse } from '@navio-blocks/shared';

/** Convert SQLite integer booleans (0/1) to real booleans on a block row. */
function toBlock(row: Record<string, unknown>): Block {
  return {
    ...row,
    is_pos: Boolean(row.is_pos),
  } as unknown as Block;
}

/** Convert SQLite integer booleans on a transaction row. */
function toTransaction(row: Record<string, unknown>): Transaction {
  return {
    ...row,
    is_coinbase: Boolean(row.is_coinbase),
    is_blsct: Boolean(row.is_blsct),
    has_token: Boolean(row.has_token),
  } as unknown as Transaction;
}

export default async function blocksRoutes(app: FastifyInstance) {
  // GET /api/blocks — Latest blocks, paginated
  app.get<{
    Querystring: { limit?: number; offset?: number };
  }>('/api/blocks', {
    schema: {
      tags: ['Blocks'],
      description: 'Get latest blocks with pagination',
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
                  height: { type: 'integer' },
                  hash: { type: 'string' },
                  prev_hash: { type: 'string' },
                  timestamp: { type: 'integer' },
                  version: { type: 'integer' },
                  merkle_root: { type: 'string' },
                  bits: { type: 'string' },
                  nonce: { type: 'integer' },
                  difficulty: { type: 'number' },
                  size: { type: 'integer' },
                  weight: { type: 'integer' },
                  tx_count: { type: 'integer' },
                  is_pos: { type: 'boolean' },
                  chainwork: { type: 'string' },
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
  }, async (request): Promise<PaginatedResponse<Block>> => {
    const limit = Math.min(Math.max(Number(request.query.limit) || 20, 1), 100);
    const offset = Math.max(Number(request.query.offset) || 0, 0);

    const rows = queryAll<Record<string, unknown>>(
      'SELECT * FROM blocks ORDER BY height DESC LIMIT ? OFFSET ?',
      limit,
      offset,
    );

    const total = queryScalar<number>('SELECT COUNT(*) FROM blocks');

    return {
      data: rows.map(toBlock),
      total,
      limit,
      offset,
    };
  });

  // GET /api/blocks/:hashOrHeight — Single block by hash or height
  app.get<{
    Params: { hashOrHeight: string };
  }>('/api/blocks/:hashOrHeight', {
    schema: {
      tags: ['Blocks'],
      description: 'Get a single block by hash or height',
      params: {
        type: 'object',
        required: ['hashOrHeight'],
        properties: {
          hashOrHeight: { type: 'string' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            height: { type: 'integer' },
            hash: { type: 'string' },
            prev_hash: { type: 'string' },
            timestamp: { type: 'integer' },
            version: { type: 'integer' },
            merkle_root: { type: 'string' },
            bits: { type: 'string' },
            nonce: { type: 'integer' },
            difficulty: { type: 'number' },
            size: { type: 'integer' },
            weight: { type: 'integer' },
            tx_count: { type: 'integer' },
            is_pos: { type: 'boolean' },
            chainwork: { type: 'string' },
          },
        },
        404: {
          type: 'object',
          properties: { error: { type: 'string' } },
        },
      },
    },
  }, async (request, reply) => {
    const { hashOrHeight } = request.params;
    const isNumeric = /^\d+$/.test(hashOrHeight);

    const row = isNumeric
      ? queryOne<Record<string, unknown>>('SELECT * FROM blocks WHERE height = ?', Number(hashOrHeight))
      : queryOne<Record<string, unknown>>('SELECT * FROM blocks WHERE hash = ?', hashOrHeight);

    if (!row) {
      return reply.status(404).send({ error: 'Block not found' });
    }

    return toBlock(row);
  });

  // GET /api/blocks/:hashOrHeight/txs — Transactions in a block
  app.get<{
    Params: { hashOrHeight: string };
    Querystring: { limit?: number; offset?: number };
  }>('/api/blocks/:hashOrHeight/txs', {
    schema: {
      tags: ['Blocks'],
      description: 'Get transactions within a block',
      params: {
        type: 'object',
        required: ['hashOrHeight'],
        properties: {
          hashOrHeight: { type: 'string' },
        },
      },
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
                },
              },
            },
            total: { type: 'integer' },
            limit: { type: 'integer' },
            offset: { type: 'integer' },
          },
        },
        404: {
          type: 'object',
          properties: { error: { type: 'string' } },
        },
      },
    },
  }, async (request, reply): Promise<PaginatedResponse<Transaction> | void> => {
    const { hashOrHeight } = request.params;
    const isNumeric = /^\d+$/.test(hashOrHeight);

    const block = isNumeric
      ? queryOne<{ height: number }>('SELECT height FROM blocks WHERE height = ?', Number(hashOrHeight))
      : queryOne<{ height: number }>('SELECT height FROM blocks WHERE hash = ?', hashOrHeight);

    if (!block) {
      return reply.status(404).send({ error: 'Block not found' });
    }

    const limit = Math.min(Math.max(Number(request.query.limit) || 20, 1), 100);
    const offset = Math.max(Number(request.query.offset) || 0, 0);

    const rows = queryAll<Record<string, unknown>>(
      'SELECT * FROM transactions WHERE block_height = ? ORDER BY tx_index LIMIT ? OFFSET ?',
      block.height,
      limit,
      offset,
    );

    const total = queryScalar<number>(
      'SELECT COUNT(*) FROM transactions WHERE block_height = ?',
      block.height,
    );

    return {
      data: rows.map(toTransaction),
      total,
      limit,
      offset,
    };
  });
}
