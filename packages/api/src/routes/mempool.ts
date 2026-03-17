import { FastifyInstance } from 'fastify';
import { rpcCall } from '../rpc.js';
import type { MempoolInfo } from '@navio-blocks/shared';

interface MempoolRpcResult {
  size: number;
  bytes: number;
  usage: number;
  total_fee: number;
  maxmempool: number;
  mempoolminfee: number;
}

export default async function mempoolRoutes(app: FastifyInstance) {
  app.get('/api/mempool', {
    schema: {
      tags: ['Mempool'],
      description: 'Live mempool information from the node',
      response: {
        200: {
          type: 'object',
          properties: {
            size: { type: 'integer' },
            bytes: { type: 'integer' },
            usage: { type: 'integer' },
            total_fee: { type: 'number' },
            max_mempool: { type: 'integer' },
            mempool_min_fee: { type: 'number' },
          },
        },
        502: {
          type: 'object',
          properties: { error: { type: 'string' } },
        },
      },
    },
  }, async (_request, reply) => {
    try {
      const info = await rpcCall<MempoolRpcResult>('getmempoolinfo');

      const result: MempoolInfo = {
        size: info.size,
        bytes: info.bytes,
        usage: info.usage,
        total_fee: info.total_fee,
        max_mempool: info.maxmempool,
        mempool_min_fee: info.mempoolminfee,
      };

      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'RPC unavailable';
      return reply.status(502).send({ error: `Failed to fetch mempool info: ${message}` });
    }
  });
}
