import { FastifyInstance } from 'fastify';
import { queryOne } from '../db.js';
import type { Block, Transaction, SearchResult } from '@navio-blocks/shared';

function toBlock(row: Record<string, unknown>): Block {
  return { ...row, is_pos: Boolean(row.is_pos) } as unknown as Block;
}

function toTransaction(row: Record<string, unknown>): Transaction {
  return {
    ...row,
    is_coinbase: Boolean(row.is_coinbase),
    is_blsct: Boolean(row.is_blsct),
    has_token: Boolean(row.has_token),
  } as unknown as Transaction;
}

export default async function searchRoutes(app: FastifyInstance) {
  app.get<{
    Querystring: { q: string };
  }>('/api/search', {
    schema: {
      tags: ['Search'],
      description: 'Search for a block by height/hash, a transaction by txid, or an output by output hash',
      querystring: {
        type: 'object',
        required: ['q'],
        properties: {
          q: { type: 'string', minLength: 1 },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['block', 'transaction', 'none'] },
            block: { type: 'object', nullable: true },
            transaction: { type: 'object', nullable: true },
          },
        },
      },
    },
  }, async (request): Promise<SearchResult> => {
    const q = request.query.q.trim();

    // If the query is a number, search by block height
    if (/^\d+$/.test(q)) {
      const row = queryOne<Record<string, unknown>>(
        'SELECT * FROM blocks WHERE height = ?',
        Number(q),
      );
      if (row) {
        return { type: 'block', block: toBlock(row) };
      }
      return { type: 'none' };
    }

    // If the query is a 64-character hex string, try block hash, txid, then output hash
    if (/^[0-9a-fA-F]{64}$/.test(q)) {
      const blockRow = queryOne<Record<string, unknown>>(
        'SELECT * FROM blocks WHERE LOWER(hash) = LOWER(?)',
        q,
      );
      if (blockRow) {
        return { type: 'block', block: toBlock(blockRow) };
      }

      const txRow = queryOne<Record<string, unknown>>(
        'SELECT * FROM transactions WHERE LOWER(txid) = LOWER(?)',
        q,
      );
      if (txRow) {
        return { type: 'transaction', transaction: toTransaction(txRow) };
      }

      const outputTxRow = queryOne<Record<string, unknown>>(
        `SELECT t.*
         FROM outputs o
         JOIN transactions t ON t.txid = o.txid
         WHERE LOWER(o.output_hash) = LOWER(?)`,
        q,
      );
      if (outputTxRow) {
        return { type: 'transaction', transaction: toTransaction(outputTxRow) };
      }
    }

    return { type: 'none' };
  });
}
