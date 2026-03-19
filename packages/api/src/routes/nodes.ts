import * as net from 'node:net';
import { lookup } from 'node:dns/promises';
import { FastifyInstance } from 'fastify';
import { queryAll } from '../db.js';
import type { Peer, NodeStats, NodeMapData } from '@navio-blocks/shared';

const NODE_ADDR_DNS_CACHE_TTL_MS = 10 * 60 * 1000;

interface ParsedEndpoint {
  host: string;
  port: number;
}

interface DnsCacheEntry {
  ip: string;
  expiresAt: number;
}

function formatAddress(address: string, port: number): string {
  return address.includes(':') ? `[${address}]:${port}` : `${address}:${port}`;
}

function parseAddressPort(addr: string): ParsedEndpoint | null {
  if (addr.startsWith('[')) {
    const closing = addr.indexOf(']');
    if (closing < 0 || addr[closing + 1] !== ':') return null;
    const host = addr.slice(1, closing);
    const port = Number(addr.slice(closing + 2));
    if (!host || !Number.isInteger(port) || port <= 0 || port > 65535) return null;
    return { host, port };
  }

  const lastColon = addr.lastIndexOf(':');
  if (lastColon <= 0) return null;
  const host = addr.slice(0, lastColon);
  const port = Number(addr.slice(lastColon + 1));
  if (!host || !Number.isInteger(port) || port <= 0 || port > 65535) return null;
  return { host, port };
}

function normalizeIpAddress(ip: string): string {
  const ipType = net.isIP(ip);
  if (ipType === 4) return ip;
  if (ipType === 6) return ip.toLowerCase();
  return ip;
}

const dnsCache = new Map<string, DnsCacheEntry>();

async function resolveHostnameToIp(host: string): Promise<string | null> {
  const cacheKey = host.toLowerCase();
  const cached = dnsCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.ip;

  try {
    const resolved = await lookup(host, { all: true, verbatim: false });
    const preferred =
      resolved.find((entry) => net.isIP(entry.address) === 4) ??
      resolved.find((entry) => net.isIP(entry.address) === 6);
    if (!preferred) return null;

    const ip = normalizeIpAddress(preferred.address);
    dnsCache.set(cacheKey, {
      ip,
      expiresAt: Date.now() + NODE_ADDR_DNS_CACHE_TTL_MS,
    });
    return ip;
  } catch {
    return null;
  }
}

async function canonicalizePeerAddress(addr: string): Promise<string> {
  const parsed = parseAddressPort(addr);
  if (!parsed) return addr;

  const host = parsed.host.trim();
  if (!host) return addr;

  if (net.isIP(host) !== 0) {
    return formatAddress(normalizeIpAddress(host), parsed.port);
  }

  const normalizedHost = host.toLowerCase();
  const resolvedIp = await resolveHostnameToIp(normalizedHost);
  return formatAddress(resolvedIp ?? normalizedHost, parsed.port);
}

async function dedupePeersByCanonicalAddress(peers: Peer[]): Promise<Peer[]> {
  if (peers.length === 0) return [];

  const canonicalAddrs = await Promise.all(
    peers.map((peer) => canonicalizePeerAddress(peer.addr))
  );
  const deduped = new Map<string, Peer>();

  for (let i = 0; i < peers.length; i++) {
    const canonicalAddr = canonicalAddrs[i];
    if (deduped.has(canonicalAddr)) continue;
    deduped.set(canonicalAddr, {
      ...peers[i],
      addr: canonicalAddr,
    });
  }

  return Array.from(deduped.values()).sort((a, b) => b.last_seen - a.last_seen);
}

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
    const peersByAddress = queryAll<Peer>(
      `SELECT p.*
       FROM peers p
       WHERE p.rowid IN (
         SELECT MAX(rowid)
         FROM peers
         GROUP BY addr
       )
       ORDER BY p.last_seen DESC`
    );
    const peers = await dedupePeersByCanonicalAddress(peersByAddress);

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
