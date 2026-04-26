import { FastifyInstance } from 'fastify';
import { queryOne, queryAll } from '../db.js';
import type { Block, Transaction, SearchResult, SearchMultiMatches } from '@navio-blocks/shared';

const PARTIAL_HASH_MIN_LEN = 4;
const PARTIAL_HASH_MAX_LEN = 63;
const PARTIAL_CATEGORY_LIMIT = 25;

function tableExists(name: string): boolean {
  try {
    return (
      queryOne<{ x: number }>(
        `SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1`,
        name,
      ) !== undefined
    );
  } catch {
    return false;
  }
}

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
            type: {
              type: 'string',
              enum: ['block', 'transaction', 'output', 'token', 'nft', 'multi', 'none'],
            },
            block: { type: 'object', nullable: true, additionalProperties: true },
            transaction: { type: 'object', nullable: true, additionalProperties: true },
            output_hash: { type: 'string', nullable: true },
            token_id: { type: 'string', nullable: true },
            nft_index: { type: 'string', nullable: true },
            matches: {
              type: 'object',
              nullable: true,
              properties: {
                blocks: { type: 'array', items: { type: 'object', additionalProperties: true } },
                transactions: { type: 'array', items: { type: 'object', additionalProperties: true } },
                output_hashes: { type: 'array', items: { type: 'string' } },
                token_ids: { type: 'array', items: { type: 'string' } },
              },
            },
          },
        },
      },
    },
  }, async (request): Promise<SearchResult> => {
    const q = request.query.q.trim();
    const qHex =
      q.startsWith('0x') || q.startsWith('0X') ? q.slice(2).trim() : q;
    const qHexLower = qHex.toLowerCase();

    const nftMatch = qHex.match(/^([0-9a-fA-F]{64})#(\d+)$/);
    if (nftMatch) {
      const [_, tokenId, nftIndex] = nftMatch;
      const nftRow = queryOne<{ token_id: string }>(
        `SELECT token_id
         FROM outputs
         WHERE LOWER(token_id) = LOWER(?)
           AND COALESCE(UPPER(predicate), '') NOT IN ('PAY_FEE', 'DATA')
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

    // If the query is a decimal block height, try that first (do not return early on miss — partial hex may still match).
    if (/^\d+$/.test(q)) {
      const row = queryOne<Record<string, unknown>>(
        'SELECT * FROM blocks WHERE height = ?',
        Number(q),
      );
      if (row) {
        return { type: 'block', block: toBlock(row) };
      }
    }

    // If the query is a 64-character hex string, try block hash, txid, then output hash
    if (/^[0-9a-fA-F]{64}$/.test(qHex)) {
      const blockRow = queryOne<Record<string, unknown>>(
        'SELECT * FROM blocks WHERE LOWER(hash) = LOWER(?)',
        qHex,
      );
      if (blockRow) {
        return { type: 'block', block: toBlock(blockRow) };
      }

      const txRow = queryOne<Record<string, unknown>>(
        'SELECT * FROM transactions WHERE LOWER(txid) = LOWER(?)',
        qHex,
      );
      if (txRow) {
        return { type: 'transaction', transaction: toTransaction(txRow) };
      }

      const outputRow = queryOne<{ output_hash: string }>(
        `SELECT output_hash FROM outputs WHERE LOWER(output_hash) = LOWER(?)`,
        qHex,
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
           AND COALESCE(UPPER(predicate), '') NOT IN ('PAY_FEE', 'DATA')
         LIMIT 1`,
        qHexLower,
      );
      if (tokenRow) {
        return { type: 'token', token_id: qHexLower };
      }
    }

    // Partial hex: substring match across chain entities
    if (
      /^[0-9a-fA-F]+$/.test(qHex) &&
      qHex.length >= PARTIAL_HASH_MIN_LEN &&
      qHex.length <= PARTIAL_HASH_MAX_LEN
    ) {
      const likePat = `%${qHexLower}%`;

      const blockRows = queryAll<Record<string, unknown>>(
        `SELECT * FROM blocks
         WHERE LOWER(hash) LIKE ?
            OR LOWER(COALESCE(prev_hash, '')) LIKE ?
            OR LOWER(COALESCE(merkle_root, '')) LIKE ?
         ORDER BY height DESC
         LIMIT ?`,
        likePat,
        likePat,
        likePat,
        PARTIAL_CATEGORY_LIMIT,
      );

      const txRows = queryAll<Record<string, unknown>>(
        `SELECT * FROM transactions
         WHERE LOWER(txid) LIKE ?
         ORDER BY block_height DESC, tx_index DESC
         LIMIT ?`,
        likePat,
        PARTIAL_CATEGORY_LIMIT,
      );

      const outputRows = queryAll<{ output_hash: string }>(
        `SELECT output_hash FROM outputs
         WHERE LOWER(output_hash) LIKE ?
         LIMIT ?`,
        likePat,
        PARTIAL_CATEGORY_LIMIT,
      );

      const tokenIdSet = new Set<string>();
      if (tableExists('token_collections')) {
        for (const row of queryAll<{ token_id: string }>(
          `SELECT token_id FROM token_collections
           WHERE LOWER(token_id) LIKE ?
           ORDER BY create_height DESC
           LIMIT ?`,
          likePat,
          PARTIAL_CATEGORY_LIMIT,
        )) {
          tokenIdSet.add(row.token_id);
        }
      }
      if (tableExists('nft_items')) {
        for (const row of queryAll<{ token_id: string }>(
          `SELECT DISTINCT token_id FROM nft_items
           WHERE LOWER(token_id) LIKE ?
           LIMIT ?`,
          likePat,
          PARTIAL_CATEGORY_LIMIT,
        )) {
          tokenIdSet.add(row.token_id);
        }
      }
      const tokenIds = [...tokenIdSet].slice(0, PARTIAL_CATEGORY_LIMIT);

      const matches: SearchMultiMatches = {
        blocks: blockRows.map(toBlock),
        transactions: txRows.map(toTransaction),
        output_hashes: outputRows.map((r) => r.output_hash),
        token_ids: tokenIds,
      };

      const hasAny =
        matches.blocks.length > 0 ||
        matches.transactions.length > 0 ||
        matches.output_hashes.length > 0 ||
        matches.token_ids.length > 0;

      if (hasAny) {
        return { type: 'multi', matches };
      }
    }

    return { type: 'none' };
  });
}
