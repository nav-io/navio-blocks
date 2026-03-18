import type { Peer } from "@navio-blocks/shared";
import type { RpcClient } from "../rpc/client.js";
import type { Queries } from "../db/queries.js";

const IP_API_RATE_LIMIT_MS = 1400; // ~43 req/min, stays safely under 45/min

interface IpApiResponse {
  country?: string;
  city?: string;
  lat?: number;
  lon?: number;
}

function toStringSafe(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "bigint" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value
      .map((v) => (typeof v === "string" ? v : String(v)))
      .join(",");
  }
  return fallback;
}

function toNumberSafe(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

function toOptionalNumberSafe(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function extractIp(addr: string): string {
  // addr format is "ip:port" or "[ipv6]:port"
  if (addr.startsWith("[")) {
    const closing = addr.indexOf("]");
    return addr.slice(1, closing);
  }
  const lastColon = addr.lastIndexOf(":");
  return lastColon !== -1 ? addr.slice(0, lastColon) : addr;
}

function isRoutableIp(ip: string): boolean {
  if (ip === "127.0.0.1" || ip === "::1" || ip === "0.0.0.0") return false;
  if (ip.startsWith("10.")) return false;
  if (ip.startsWith("192.168.")) return false;
  if (ip.startsWith("172.")) {
    const second = parseInt(ip.split(".")[1], 10);
    if (second >= 16 && second <= 31) return false;
  }
  if (ip.startsWith("fc") || ip.startsWith("fd") || ip.startsWith("fe80")) return false;
  return true;
}

async function geolocateIp(ip: string): Promise<IpApiResponse> {
  try {
    const res = await fetch(
      `http://ip-api.com/json/${ip}?fields=country,city,lat,lon`
    );
    if (!res.ok) return {};
    return (await res.json()) as IpApiResponse;
  } catch {
    return {};
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Addresses we've already geolocated — avoids re-fetching on every cycle. */
const geoCache = new Map<string, { geo: IpApiResponse; expiresAt: number }>();
const GEO_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

async function geolocateCached(ip: string): Promise<IpApiResponse> {
  const cached = geoCache.get(ip);
  if (cached && cached.expiresAt > Date.now()) return cached.geo;
  const geo = await geolocateIp(ip);
  geoCache.set(ip, { geo, expiresAt: Date.now() + GEO_CACHE_TTL_MS });
  return geo;
}

export async function updatePeers(
  rpc: RpcClient,
  queries: Queries
): Promise<void> {
  try {
    const now = Math.floor(Date.now() / 1000);

    // 1. Direct connections from getpeerinfo (rich data: subversion, services)
    const rpcPeers = (await rpc.getPeerInfo()) as Record<string, unknown>[];
    console.log(`[peers] Direct peers: ${rpcPeers.length}`);

    // Track addresses we've already processed to avoid duplicate geo lookups
    const seenAddrs = new Set<string>();
    let geoCount = 0;

    for (const rp of rpcPeers) {
      const peerId = toNumberSafe(rp.id, NaN);
      if (!Number.isFinite(peerId)) continue;

      const addr = toStringSafe(rp.addr, "");
      seenAddrs.add(addr);
      const ip = extractIp(addr);

      let geo: IpApiResponse = {};
      if (isRoutableIp(ip)) {
        geo = await geolocateCached(ip);
        if (++geoCount < rpcPeers.length) await sleep(IP_API_RATE_LIMIT_MS);
      }

      const connTime = toNumberSafe(rp.conntime, now);
      const servicesNames = rp.servicesnames;
      const services =
        Array.isArray(servicesNames) && servicesNames.length > 0
          ? servicesNames.map((v) => toStringSafe(v)).join(",")
          : toStringSafe(servicesNames, toStringSafe(rp.services, ""));

      const peer: Peer = {
        id: peerId,
        addr,
        subversion: toStringSafe(rp.subver, ""),
        services,
        country: toStringSafe(geo.country, "") || undefined,
        city: toStringSafe(geo.city, "") || undefined,
        lat: toOptionalNumberSafe(geo.lat),
        lon: toOptionalNumberSafe(geo.lon),
        last_seen: now,
        first_seen: connTime,
      };

      queries.upsertPeer(peer);
    }

    // 2. Discovered addresses from the address manager (gossip network)
    //    getnodeaddresses(0) returns all known addresses.
    try {
      const knownAddrs = (await rpc.getNodeAddresses(0)) as Record<string, unknown>[];
      let newCount = 0;

      for (const entry of knownAddrs) {
        const address = toStringSafe(entry.address, "");
        const port = toNumberSafe(entry.port, 0);
        if (!address || !port) continue;

        const addr = address.includes(":") ? `[${address}]:${port}` : `${address}:${port}`;
        if (seenAddrs.has(addr)) continue;
        seenAddrs.add(addr);

        const ip = address;
        let geo: IpApiResponse = {};
        if (isRoutableIp(ip)) {
          geo = await geolocateCached(ip);
          // Only rate-limit if we actually hit the API (not cached)
          const cached = geoCache.get(ip);
          if (cached && cached.expiresAt - GEO_CACHE_TTL_MS + 2000 > Date.now() - 2000) {
            // freshly fetched, rate limit
            await sleep(IP_API_RATE_LIMIT_MS);
          }
        }

        const lastSeen = toNumberSafe(entry.time, now);
        const services = toStringSafe(entry.services, "");

        const peer: Peer = {
          id: 0, // no RPC peer id for discovered nodes
          addr,
          subversion: "",
          services,
          country: toStringSafe(geo.country, "") || undefined,
          city: toStringSafe(geo.city, "") || undefined,
          lat: toOptionalNumberSafe(geo.lat),
          lon: toOptionalNumberSafe(geo.lon),
          last_seen: lastSeen,
          first_seen: lastSeen,
        };

        queries.upsertPeer(peer);
        newCount++;
      }

      console.log(`[peers] Discovered ${newCount} additional peers from address manager (${knownAddrs.length} total known)`);
    } catch (err) {
      // getnodeaddresses may not be available on older nodes
      console.warn("[peers] getnodeaddresses not available:", (err as Error).message);
    }

    // Keep one row per address (latest observation).
    queries.compactPeersByAddress();

    // Remove peers not seen in 7 days (longer window for discovered peers)
    const cutoff = now - 7 * 24 * 60 * 60;
    queries.deleteOldPeers(cutoff);

    console.log(`[peers] Peer update complete, ${seenAddrs.size} total addresses`);
  } catch (err) {
    console.error("[peers] Error updating peers:", err);
  }
}
