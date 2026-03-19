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
      description: 'Search for a block, transaction, output, token collection, or NFT',
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
            type: { type: 'string', enum: ['block', 'transaction', 'output', 'token', 'nft', 'none'] },
            block: { type: 'object', nullable: true },
            transaction: { type: 'object', nullable: true },
            output_hash: { type: 'string', nullable: true },
            token_id: { type: 'string', nullable: true },
            nft_index: { type: 'string', nullable: true },
          },
        },
      },
    },
  }, async (request): Promise<SearchResult> => {
    const q = request.query.q.trim();
    const qLower = q.toLowerCase();

    const nftMatch = q.match(/^([0-9a-fA-F]{64})#(\d+)$/);
    if (nftMatch) {
      const [_, tokenId, nftIndex] = nftMatch;
      const nftRow = queryOne<{ token_id: string }>(
        `SELECT token_id
         FROM outputs
         WHERE LOWER(token_id) = LOWER(?)
         LIMIT 1`,
        `${tokenId.toLowerCase()}#${nftIndex}`,
      );
      if (nftRow) {
        return {
          type: 'nft',
          token_id: tokenId.toLowerCase(),
          nft_index: nftIndex,
        };
      }
    }

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

      const outputRow = queryOne<{ output_hash: string }>(
        `SELECT output_hash FROM outputs WHERE LOWER(output_hash) = LOWER(?)`,
        q,
      );
      if (outputRow) {
        return { type: 'output', output_hash: outputRow.output_hash };
      }

      const tokenRow = queryOne<{ token_id: string }>(
        `SELECT token_id
         FROM outputs
         WHERE LOWER(
           CASE
             WHEN instr(token_id, '#') > 0
               THEN substr(token_id, 1, instr(token_id, '#') - 1)
             ELSE token_id
           END
         ) = LOWER(?)
           AND token_id IS NOT NULL
           AND token_id <> ''
         LIMIT 1`,
        qLower,
      );
      if (tokenRow) {
        return { type: 'token', token_id: qLower };
      }
    }

    return { type: 'none' };
  });
}
