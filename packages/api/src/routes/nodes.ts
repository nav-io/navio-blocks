import { FastifyInstance } from 'fastify';
import { queryAll, queryScalar } from '../db.js';
import type { Peer, NodeStats, NodeMapData } from '@navio-blocks/shared';

export default async function nodesRoutes(app: FastifyInstance) {
  // GET /api/nodes — Peer statistics with aggregations
  app.get('/api/nodes', {
    schema: {
      tags: ['Nodes'],
      description: 'Peer statistics with country and version aggregations',
      response: {
        200: {
          type: 'object',
          properties: {
            total_nodes: { type: 'integer' },
            countries: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  country: { type: 'string' },
                  count: { type: 'integer' },
                },
              },
            },
            versions: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  version: { type: 'string' },
                  count: { type: 'integer' },
                },
              },
            },
            peers: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'integer' },
                  addr: { type: 'string' },
                  subversion: { type: 'string' },
                  services: { type: 'string' },
                  country: { type: 'string', nullable: true },
                  city: { type: 'string', nullable: true },
                  lat: { type: 'number', nullable: true },
                  lon: { type: 'number', nullable: true },
                  last_seen: { type: 'integer' },
                  first_seen: { type: 'integer' },
                },
              },
            },
          },
        },
      },
    },
  }, async (): Promise<NodeStats> => {
    const peers = queryAll<Peer>(
      `SELECT p.*
       FROM peers p
       WHERE p.rowid IN (
         SELECT MAX(rowid)
         FROM peers
         GROUP BY addr
       )
       ORDER BY p.last_seen DESC`
    );

    const totalNodes = peers.length;

    const countryMap = new Map<string, number>();
    const versionMap = new Map<string, number>();

    for (const peer of peers) {
      const country = peer.country ?? 'Unknown';
      countryMap.set(country, (countryMap.get(country) ?? 0) + 1);

      const version = peer.subversion || 'Unknown';
      versionMap.set(version, (versionMap.get(version) ?? 0) + 1);
    }

    const countries = Array.from(countryMap.entries())
      .map(([country, count]) => ({ country, count }))
      .sort((a, b) => b.count - a.count);

    const versions = Array.from(versionMap.entries())
      .map(([version, count]) => ({ version, count }))
      .sort((a, b) => b.count - a.count);

    return {
      total_nodes: totalNodes,
      countries,
      versions,
      peers,
    };
  });

  // GET /api/nodes/map — Peer data for map rendering
  app.get('/api/nodes/map', {
    schema: {
      tags: ['Nodes'],
      description: 'Peer geolocation data for map visualization',
      response: {
        200: {
          type: 'object',
          properties: {
            peers: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  lat: { type: 'number' },
                  lon: { type: 'number' },
                  country: { type: 'string' },
                  city: { type: 'string' },
                  subversion: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
  }, async (): Promise<NodeMapData> => {
    const peers = queryAll<{ lat: number; lon: number; country: string; city: string; subversion: string }>(
      `SELECT
         p.lat,
         p.lon,
         COALESCE(p.country, 'Unknown') AS country,
         COALESCE(p.city, 'Unknown') AS city,
         p.subversion
       FROM peers p
       WHERE p.rowid IN (
         SELECT MAX(rowid)
         FROM peers
         GROUP BY addr
       )
       AND p.lat IS NOT NULL
       AND p.lon IS NOT NULL`,
    );

    return { peers };
  });
}
