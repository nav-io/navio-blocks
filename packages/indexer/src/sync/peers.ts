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

export async function updatePeers(
  rpc: RpcClient,
  queries: Queries
): Promise<void> {
  try {
    const rpcPeers = (await rpc.getPeerInfo()) as Record<string, unknown>[];
    const now = Math.floor(Date.now() / 1000);

    console.log(`[peers] Updating ${rpcPeers.length} peers`);

    for (let i = 0; i < rpcPeers.length; i++) {
      const rp = rpcPeers[i];
      const peerId = toNumberSafe(rp.id, NaN);
      if (!Number.isFinite(peerId)) {
        console.warn("[peers] Skipping peer with invalid id:", rp.id);
        continue;
      }

      const addr = toStringSafe(rp.addr, "");
      const ip = extractIp(addr);

      let geo: IpApiResponse = {};
      if (isRoutableIp(ip)) {
        geo = await geolocateIp(ip);
        // Rate-limit IP API requests
        if (i < rpcPeers.length - 1) {
          await sleep(IP_API_RATE_LIMIT_MS);
        }
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

    // Keep one row per address (latest observation).
    queries.compactPeersByAddress();

    // Remove peers not seen in 24 hours
    const cutoff = now - 24 * 60 * 60;
    queries.deleteOldPeers(cutoff);

    console.log(`[peers] Peer update complete`);
  } catch (err) {
    console.error("[peers] Error updating peers:", err);
  }
}
