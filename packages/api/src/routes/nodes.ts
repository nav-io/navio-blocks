import * as net from 'node:net';
import { lookup } from 'node:dns/promises';
import { FastifyInstance } from 'fastify';
import { queryAll, queryOne } from '../db.js';
import { currentNetwork } from '../context.js';
import type {
  Peer,
  NodeStats,
  NodeMapData,
  NodeHistoryPoint,
  ChartPeriod,
} from '@navio-blocks/shared';

/**
 * Read the `reachable=` flag from a peer's services CSV string.
 * Returns true/false when explicitly set, or undefined when no probe was done.
 */
function parseReachableFlag(services: string | null | undefined): boolean | undefined {
  if (!services) return undefined;
  const parts = services.split(',').map((p) => p.trim());
  for (const part of parts) {
    if (part === 'reachable=1') return true;
    if (part === 'reachable=0') return false;
  }
  return undefined;
}

/** Service bit → name, as navio-core's serviceFlagToStr (src/protocol.cpp). */
const SERVICE_FLAG_NAMES: Record<number, string> = {
  0: 'NETWORK',
  2: 'BLOOM',
  3: 'WITNESS',
  6: 'COMPACT_FILTERS',
  10: 'NETWORK_LIMITED',
  11: 'P2P_V2',
  24: 'P2PMSG',
  25: 'P2PMSG_LEAF',
  26: 'P2PMSG_ARCHIVE',
  27: 'P2PMSG_V2',
  28: 'OUTKEYS',
  29: 'OUTKEYS_PIR',
  30: 'P2P_WS',
};

/** Tracked bits in display order: Navio-specific ones plus BIP324 (P2P_V2). */
const NAVIO_SERVICE_FLAGS = [
  'P2P_WS',
  'P2P_V2',
  'P2PMSG_V2',
  'P2PMSG_ARCHIVE',
  'P2PMSG_LEAF',
  'P2PMSG',
];

const SERVICE_FLAG_ORDER = Object.entries(SERVICE_FLAG_NAMES)
  .sort(([a], [b]) => Number(a) - Number(b))
  .map(([, name]) => name);

function bitName(bit: number): string {
  return SERVICE_FLAG_NAMES[bit] ?? `BIT_${bit}`;
}

/**
 * Decode the peer's services CSV into flag names. The indexer stores either
 * names from getpeerinfo (`NETWORK,WITNESS,P2PMSG`, where an older node prints
 * `UNKNOWN[2^27]` for bits it predates) or a raw decimal bitmask from the P2P
 * crawl (`150995977`), alongside `key=value` tags that are skipped here.
 */
function parseServiceFlags(services: string | null | undefined): string[] {
  if (!services) return [];
  const flags = new Set<string>();
  for (const raw of services.split(',')) {
    const part = raw.trim();
    if (!part || part.includes('=')) continue;
    if (/^\d+$/.test(part)) {
      let mask = BigInt(part);
      for (let bit = 0; mask > 0n; bit++, mask >>= 1n) {
        if (mask & 1n) flags.add(bitName(bit));
      }
      continue;
    }
    const unknown = /^UNKNOWN\[2\^(\d+)\]$/.exec(part);
    flags.add(unknown ? bitName(Number(unknown[1])) : part.toUpperCase());
  }
  const order = (f: string): number => {
    const i = SERVICE_FLAG_ORDER.indexOf(f);
    return i < 0 ? SERVICE_FLAG_ORDER.length : i;
  };
  return [...flags].sort((a, b) => order(a) - order(b) || a.localeCompare(b));
}

/** WebSocket endpoint from the indexer's `wsport=` / `wsurl=` tags. */
function parseWsEndpoint(
  services: string | null | undefined
): { port: number; url?: string } | undefined {
  if (!services) return undefined;
  let port = 0;
  let url: string | undefined;
  for (const raw of services.split(',')) {
    const part = raw.trim();
    if (part.startsWith('wsport=')) port = Number(part.slice(7));
    else if (part.startsWith('wsurl=')) {
      try {
        url = decodeURIComponent(part.slice(6));
      } catch {
        url = undefined;
      }
    }
  }
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return undefined;
  return url && /^wss?:\/\//.test(url) ? { port, url } : { port };
}

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

/**
 * Rank two peers that share an IP. Higher score wins the slot. We prefer a
 * confirmed listening endpoint (reachable=1), then the most recently seen one.
 * This collapses the many inbound connections a single node opens to us — each
 * carries a different ephemeral source port but is the same physical node.
 */
function isBetterRepresentative(candidate: Peer, current: Peer): boolean {
  const candReachable = parseReachableFlag(candidate.services);
  const currReachable = parseReachableFlag(current.services);
  const rank = (r: boolean | undefined): number => (r === true ? 2 : r === false ? 1 : 0);
  const candRank = rank(candReachable);
  const currRank = rank(currReachable);
  if (candRank !== currRank) return candRank > currRank;
  return candidate.last_seen > current.last_seen;
}

async function dedupePeersByCanonicalAddress(peers: Peer[]): Promise<Peer[]> {
  if (peers.length === 0) return [];

  const canonicalAddrs = await Promise.all(
    peers.map((peer) => canonicalizePeerAddress(peer.addr))
  );
  const deduped = new Map<string, Peer>();

  for (let i = 0; i < peers.length; i++) {
    const canonicalAddr = canonicalAddrs[i];
    // Group by IP only: multiple entries for one IP (differing only by an
    // ephemeral source port) are the same node and should collapse to one row.
    const parsed = parseAddressPort(canonicalAddr);
    const key = parsed ? parsed.host : canonicalAddr;
    const peer: Peer = { ...peers[i], addr: canonicalAddr };
    const existing = deduped.get(key);
    if (!existing || isBetterRepresentative(peer, existing)) {
      deduped.set(key, peer);
    }
  }

  return Array.from(deduped.values()).sort((a, b) => b.last_seen - a.last_seen);
}

/**
 * Same 7-day retention the indexer prunes with. Filtering here too keeps the
 * live counts consistent with the node_stats snapshots even if stale rows are
 * momentarily present mid-crawl.
 */
function peerCutoff(): number {
  return Math.floor(Date.now() / 1000) - 7 * 24 * 60 * 60;
}

/** Lookback window and bucket size per chart period. */
const HISTORY_WINDOWS: Record<ChartPeriod, { span: number; bucket: number }> = {
  '24h': { span: 86400, bucket: 1800 },          // 30 min (crawl runs every 10 min)
  '7d': { span: 7 * 86400, bucket: 3600 },       // hourly
  '30d': { span: 30 * 86400, bucket: 6 * 3600 }, // 6-hourly
  '1y': { span: 365 * 86400, bucket: 86400 },    // daily
};

/** True when the node_stats table exists (older DBs may predate it). */
function nodeStatsTableExists(): boolean {
  try {
    const row = queryOne<{ n: number }>(
      `SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'node_stats'`,
    );
    return (row?.n ?? 0) > 0;
  } catch {
    return false;
  }
}

export default async function nodesRoutes(app: FastifyInstance) {
  // GET /api/nodes/history — total / listening / active node counts over time
  app.get<{ Querystring: { period?: ChartPeriod } }>('/nodes/history', {
    schema: {
      tags: ['Nodes'],
      description: 'Total, listening and active (3h) node counts over time, from indexer peer-crawl snapshots',
      querystring: {
        type: 'object',
        properties: {
          period: { type: 'string', enum: ['24h', '7d', '30d', '1y'], default: '7d' },
        },
      },
      response: {
        200: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              timestamp: { type: 'integer' },
              total: { type: 'integer' },
              listening: { type: 'integer' },
              active: { type: 'integer' },
            },
          },
        },
      },
    },
  }, async (request): Promise<NodeHistoryPoint[]> => {
    if (!nodeStatsTableExists()) return [];
    const period = (request.query.period ?? '7d') as ChartPeriod;
    const { span, bucket } = HISTORY_WINDOWS[period] ?? HISTORY_WINDOWS['7d'];
    const cutoff = Math.floor(Date.now() / 1000) - span;

    const rows = queryAll<{ timestamp: number; total: number; listening: number; active: number }>(
      `SELECT (timestamp / CAST(? AS INTEGER)) * CAST(? AS INTEGER) AS timestamp,
              AVG(total) AS total,
              AVG(listening) AS listening,
              AVG(active) AS active
       FROM node_stats
       WHERE network = ? AND timestamp >= ?
       GROUP BY timestamp / CAST(? AS INTEGER)
       ORDER BY timestamp`,
      bucket, bucket, currentNetwork(), cutoff, bucket,
    );
    return rows.map((r) => ({
      timestamp: r.timestamp,
      total: Math.round(r.total),
      listening: Math.round(r.listening),
      active: Math.round(r.active),
    }));
  });

  // GET /api/nodes — Peer statistics with aggregations
  app.get('/nodes', {
    schema: {
      tags: ['Nodes'],
      description: 'Peer statistics with country and version aggregations',
      response: {
        200: {
          type: 'object',
          properties: {
            total_nodes: { type: 'integer' },
            listening_nodes: { type: 'integer' },
            non_listening_nodes: { type: 'integer' },
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
            navio_services: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  flag: { type: 'string' },
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
                  reachable: { type: 'boolean', nullable: true },
                  last_handshake: { type: 'integer', nullable: true },
                  service_flags: { type: 'array', items: { type: 'string' } },
                  ws_endpoint: {
                    type: 'object',
                    nullable: true,
                    properties: {
                      port: { type: 'integer' },
                      url: { type: 'string' },
                    },
                  },
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
       AND p.last_seen >= ?
       ORDER BY p.last_seen DESC`,
      peerCutoff(),
    );
    const dedupedPeers = await dedupePeersByCanonicalAddress(peersByAddress);
    const peers: Peer[] = dedupedPeers.map((peer) => ({
      ...peer,
      reachable: parseReachableFlag(peer.services),
      last_handshake:
        typeof peer.last_handshake === 'number' && peer.last_handshake > 0
          ? peer.last_handshake
          : undefined,
      service_flags: parseServiceFlags(peer.services),
      ws_endpoint: parseWsEndpoint(peer.services),
    }));

    const totalNodes = peers.length;
    let listeningNodes = 0;
    let nonListeningNodes = 0;

    const countryMap = new Map<string, number>();
    const versionMap = new Map<string, number>();
    const navioServiceMap = new Map<string, number>(
      NAVIO_SERVICE_FLAGS.map((flag) => [flag, 0]),
    );

    for (const peer of peers) {
      const country = peer.country ?? 'Unknown';
      countryMap.set(country, (countryMap.get(country) ?? 0) + 1);

      // Skip peers with no advertised subversion: they're addresses we've
      // only ever heard about via gossip and never handshook with, so they
      // don't have a meaningful version to attribute to the distribution.
      const version = peer.subversion?.trim();
      if (version) {
        versionMap.set(version, (versionMap.get(version) ?? 0) + 1);
      }

      for (const flag of peer.service_flags ?? []) {
        const n = navioServiceMap.get(flag);
        if (n !== undefined) navioServiceMap.set(flag, n + 1);
      }

      if (peer.reachable === true) listeningNodes++;
      else if (peer.reachable === false) nonListeningNodes++;
    }

    const countries = Array.from(countryMap.entries())
      .map(([country, count]) => ({ country, count }))
      .sort((a, b) => b.count - a.count);

    const versions = Array.from(versionMap.entries())
      .map(([version, count]) => ({ version, count }))
      .sort((a, b) => b.count - a.count);

    return {
      total_nodes: totalNodes,
      listening_nodes: listeningNodes,
      non_listening_nodes: nonListeningNodes,
      countries,
      versions,
      navio_services: Array.from(navioServiceMap.entries()).map(([flag, count]) => ({
        flag,
        count,
      })),
      peers,
    };
  });

  // GET /api/nodes/map — Peer data for map rendering
  app.get('/nodes/map', {
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
                  reachable: { type: 'boolean', nullable: true },
                },
              },
            },
          },
        },
      },
    },
  }, async (): Promise<NodeMapData> => {
    const rows = queryAll<{
      addr: string;
      lat: number;
      lon: number;
      country: string;
      city: string;
      subversion: string;
      services: string | null;
      last_seen: number;
    }>(
      `SELECT
         p.addr,
         p.lat,
         p.lon,
         COALESCE(p.country, 'Unknown') AS country,
         COALESCE(p.city, 'Unknown') AS city,
         p.subversion,
         p.services,
         p.last_seen
       FROM peers p
       WHERE p.rowid IN (
         SELECT MAX(rowid)
         FROM peers
         GROUP BY addr
       )
       AND p.last_seen >= ?
       AND p.lat IS NOT NULL
       AND p.lon IS NOT NULL`,
      peerCutoff(),
    );

    // Collapse rows sharing an IP (differing only by ephemeral source port) to
    // one point per node, mirroring the /nodes dedup.
    const canonicalAddrs = await Promise.all(
      rows.map((row) => canonicalizePeerAddress(row.addr))
    );
    const byIp = new Map<string, (typeof rows)[number]>();
    for (let i = 0; i < rows.length; i++) {
      const parsed = parseAddressPort(canonicalAddrs[i]);
      const key = parsed ? parsed.host : canonicalAddrs[i];
      const existing = byIp.get(key);
      const candReachable = parseReachableFlag(rows[i].services);
      const currReachable = existing ? parseReachableFlag(existing.services) : undefined;
      const rank = (r: boolean | undefined): number =>
        r === true ? 2 : r === false ? 1 : 0;
      if (
        !existing ||
        rank(candReachable) > rank(currReachable) ||
        (rank(candReachable) === rank(currReachable) &&
          rows[i].last_seen > existing.last_seen)
      ) {
        byIp.set(key, rows[i]);
      }
    }

    const peers = Array.from(byIp.values()).map(
      ({ services, addr, last_seen, ...rest }) => ({
        ...rest,
        reachable: parseReachableFlag(services),
      })
    );

    return { peers };
  });
}
