import * as net from "node:net";
import * as crypto from "node:crypto";
import { lookup } from "node:dns/promises";
import type { NetworkType, Peer } from "@navio-blocks/shared";
import type { RpcClient } from "../rpc/client.js";
import type { Queries } from "../db/queries.js";

const IP_API_RATE_LIMIT_MS = 1400; // ~43 req/min, stays safely under 45/min
const GEO_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const PROBE_CACHE_TTL_MS = 8 * 60 * 1000;
const P2P_MAX_PAYLOAD_BYTES = 4 * 1024 * 1024;
const P2P_HEADER_BYTES = 24;
const P2P_COMMAND_BYTES = 12;

const DEFAULT_TESTNET_BOOTSTRAP_NODES = [
  "testnet.nav.io",
  "testnet2.nav.io",
];

const DEFAULT_MAINNET_P2P_PORT = 8333;
const DEFAULT_TESTNET_P2P_PORT = 33670;

const DEFAULT_MAINNET_MAGIC_HEX = "dbd2b1ac";
const DEFAULT_TESTNET_MAGIC_HEX = "1c03bb83";

const P2P_PROTOCOL_VERSION = parseIntegerEnv("P2P_PROTOCOL_VERSION", 70016, 60000, 900000);
const P2P_REQUEST_TIMEOUT_MS = parseIntegerEnv(
  "P2P_REQUEST_TIMEOUT_MS",
  4500,
  500,
  120_000
);
const P2P_CRAWL_CONCURRENCY = parseIntegerEnv(
  "P2P_CRAWL_CONCURRENCY",
  24,
  1,
  1000
);
const P2P_MAX_ADDRS_PER_PEER = parseIntegerEnv("P2P_MAX_ADDRS_PER_PEER", 1024, 1, 50000);

const PEER_DISCOVERY_ROUNDS = parseIntegerEnv("PEER_DISCOVERY_ROUNDS", 3, 0, 20);
const PEER_DISCOVERY_BATCH_SIZE = parseIntegerEnv(
  "PEER_DISCOVERY_BATCH_SIZE",
  64,
  1,
  2000
);
const PEER_DISCOVERY_WAIT_MS = parseIntegerEnv(
  "PEER_DISCOVERY_WAIT_MS",
  1200,
  100,
  120_000
);
const PEER_DISCOVERY_MAX_CANDIDATES = parseIntegerEnv(
  "PEER_DISCOVERY_MAX_CANDIDATES",
  2000,
  100,
  100_000
);
const PEER_CONNECT_TIMEOUT_MS = parseIntegerEnv(
  "PEER_CONNECT_TIMEOUT_MS",
  2000,
  200,
  30_000
);
const PEER_CONNECT_CONCURRENCY = parseIntegerEnv(
  "PEER_CONNECT_CONCURRENCY",
  48,
  1,
  1000
);
const PEER_CONNECT_TEST_LIMIT = parseIntegerEnv(
  "PEER_CONNECT_TEST_LIMIT",
  300,
  1,
  100_000
);
const PEER_DISCOVERY_FILTER_UNREACHABLE = parseBooleanEnv(
  "PEER_DISCOVERY_FILTER_UNREACHABLE",
  true
);
const PEER_GEO_LOOKUP_LIMIT = parseIntegerEnv("PEER_GEO_LOOKUP_LIMIT", 80, 0, 2000);

interface IpApiResponse {
  country?: string;
  city?: string;
  lat?: number;
  lon?: number;
}

interface KnownNodeAddress {
  address: string;
  port: number;
  services: string;
  time: number;
}

interface GeoCacheValue {
  geo: IpApiResponse;
  expiresAt: number;
}

interface SeedEndpoint {
  host: string;
  port: number;
}

interface P2PCrawlResult {
  reachable: boolean;
  handshake: boolean;
  addresses: KnownNodeAddress[];
}

interface ParsedMessage {
  command: string;
  payload: Buffer;
}

function parseIntegerEnv(
  key: string,
  fallback: number,
  min: number,
  max: number
): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  const rounded = Math.floor(parsed);
  if (rounded < min) return min;
  if (rounded > max) return max;
  return rounded;
}

function parseBooleanEnv(key: string, fallback: boolean): boolean {
  const raw = process.env[key];
  if (!raw) return fallback;
  const normalized = raw.trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
  return fallback;
}

function parseCsv(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

function toStringSafe(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (
    typeof value === "number" ||
    typeof value === "bigint" ||
    typeof value === "boolean"
  ) {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map((v) => toStringSafe(v)).join(",");
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

function formatAddress(address: string, port: number): string {
  return address.includes(":") ? `[${address}]:${port}` : `${address}:${port}`;
}

function parseAddressPort(addr: string): { host: string; port: number } | null {
  if (addr.startsWith("[")) {
    const closing = addr.indexOf("]");
    if (closing < 0 || addr[closing + 1] !== ":") return null;
    const host = addr.slice(1, closing);
    const port = Number(addr.slice(closing + 2));
    if (!host || !Number.isInteger(port) || port <= 0 || port > 65535) return null;
    return { host, port };
  }

  const lastColon = addr.lastIndexOf(":");
  if (lastColon <= 0) return null;
  const host = addr.slice(0, lastColon);
  const port = Number(addr.slice(lastColon + 1));
  if (!host || !Number.isInteger(port) || port <= 0 || port > 65535) return null;
  return { host, port };
}

function extractIp(addr: string): string {
  if (addr.startsWith("[")) {
    const closing = addr.indexOf("]");
    return closing > 1 ? addr.slice(1, closing) : addr;
  }
  const lastColon = addr.lastIndexOf(":");
  return lastColon !== -1 ? addr.slice(0, lastColon) : addr;
}

function isRoutableIp(ip: string): boolean {
  const ipType = net.isIP(ip);
  if (ipType === 0) return false;

  if (ipType === 4) {
    if (ip === "127.0.0.1" || ip === "0.0.0.0") return false;
    if (ip.startsWith("10.")) return false;
    if (ip.startsWith("192.168.")) return false;
    if (ip.startsWith("172.")) {
      const second = parseInt(ip.split(".")[1], 10);
      if (second >= 16 && second <= 31) return false;
    }
    return true;
  }

  const lower = ip.toLowerCase();
  if (lower === "::1") return false;
  if (lower.startsWith("fc") || lower.startsWith("fd")) return false;
  if (lower.startsWith("fe80")) return false;
  return true;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseSeedEntry(seed: string, defaultPort: number): SeedEndpoint | null {
  const trimmed = seed.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith("[")) {
    const parsed = parseAddressPort(trimmed);
    if (!parsed) return null;
    return parsed;
  }

  const colonCount = (trimmed.match(/:/g) ?? []).length;
  if (colonCount === 1) {
    const parsed = parseAddressPort(trimmed);
    if (!parsed) return null;
    return parsed;
  }

  return { host: trimmed, port: defaultPort };
}

function resolveBootstrapNodes(network: NetworkType): string[] {
  if (network === "testnet") {
    const configured = parseCsv(process.env.TESTNET_BOOTSTRAP_NODES);
    if (configured.length > 0) return [...new Set(configured)];
    return [...DEFAULT_TESTNET_BOOTSTRAP_NODES];
  }

  const configured = parseCsv(process.env.MAINNET_BOOTSTRAP_NODES);
  return [...new Set(configured)];
}

function getDefaultP2pPort(network: NetworkType): number {
  const generic = parseIntegerEnv("P2P_PORT", 0, 0, 65535);
  if (generic > 0) return generic;

  if (network === "testnet") {
    return parseIntegerEnv(
      "TESTNET_P2P_PORT",
      DEFAULT_TESTNET_P2P_PORT,
      1,
      65535
    );
  }

  return parseIntegerEnv("MAINNET_P2P_PORT", DEFAULT_MAINNET_P2P_PORT, 1, 65535);
}

function normalizeMagicHex(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]{8}$/.test(normalized)) {
    throw new Error(
      `Invalid P2P magic '${value}'. Expected exactly 8 hex chars (example: 3224f217)`
    );
  }
  return normalized;
}

function getNetworkMagic(network: NetworkType): Buffer {
  const explicit = process.env.P2P_MESSAGE_MAGIC_HEX;
  const networkValue =
    network === "testnet"
      ? process.env.P2P_TESTNET_MAGIC_HEX ?? DEFAULT_TESTNET_MAGIC_HEX
      : process.env.P2P_MAINNET_MAGIC_HEX ?? DEFAULT_MAINNET_MAGIC_HEX;

  const magicHex = normalizeMagicHex(explicit ?? networkValue);
  return Buffer.from(magicHex, "hex");
}

function stableDiscoveredPeerId(addr: string): number {
  // FNV-1a 32-bit hash, forced into negative signed range to avoid RPC peer-id collisions.
  let hash = 0x811c9dc5;
  for (let i = 0; i < addr.length; i++) {
    hash ^= addr.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  const positive31 = (hash >>> 0) & 0x7fffffff;
  return -(positive31 === 0 ? 1 : positive31);
}

function withReachabilityTag(
  services: string,
  reachable: boolean | undefined
): string {
  const base = services
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && !part.startsWith("reachable="));

  if (reachable === undefined) return base.join(",");
  base.push(`reachable=${reachable ? "1" : "0"}`);
  return base.join(",");
}

async function geolocateIp(ip: string): Promise<IpApiResponse> {
  try {
    const res = await fetch(`http://ip-api.com/json/${ip}?fields=country,city,lat,lon`);
    if (!res.ok) return {};
    return (await res.json()) as IpApiResponse;
  } catch {
    return {};
  }
}

const geoCache = new Map<string, GeoCacheValue>();
async function geolocateCached(ip: string): Promise<IpApiResponse> {
  const cached = geoCache.get(ip);
  if (cached && cached.expiresAt > Date.now()) return cached.geo;

  const geo = await geolocateIp(ip);
  geoCache.set(ip, { geo, expiresAt: Date.now() + GEO_CACHE_TTL_MS });
  return geo;
}

const reachabilityCache = new Map<string, { reachable: boolean; expiresAt: number }>();
async function probeTcpAddress(addr: string): Promise<boolean> {
  const cached = reachabilityCache.get(addr);
  if (cached && cached.expiresAt > Date.now()) return cached.reachable;

  const parsed = parseAddressPort(addr);
  if (!parsed) return false;

  const reachable = await new Promise<boolean>((resolve) => {
    const socket = net.createConnection({ host: parsed.host, port: parsed.port });
    let settled = false;

    const finalize = (ok: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(ok);
    };

    socket.setTimeout(PEER_CONNECT_TIMEOUT_MS, () => finalize(false));
    socket.once("connect", () => finalize(true));
    socket.once("error", () => finalize(false));
  });

  reachabilityCache.set(addr, {
    reachable,
    expiresAt: Date.now() + PROBE_CACHE_TTL_MS,
  });
  return reachable;
}

async function probeReachability(addresses: string[]): Promise<Map<string, boolean>> {
  const results = new Map<string, boolean>();
  if (addresses.length === 0) return results;

  const workerCount = Math.min(PEER_CONNECT_CONCURRENCY, addresses.length);
  let index = 0;

  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const current = index;
      index += 1;
      if (current >= addresses.length) break;

      const addr = addresses[current];
      const reachable = await probeTcpAddress(addr);
      results.set(addr, reachable);
    }
  });

  await Promise.all(workers);
  return results;
}

function sha256d(payload: Buffer): Buffer {
  const first = crypto.createHash("sha256").update(payload).digest();
  return crypto.createHash("sha256").update(first).digest();
}

function encodeVarInt(value: bigint): Buffer {
  if (value < 0xfdn) {
    return Buffer.from([Number(value)]);
  }
  if (value <= 0xffffn) {
    const b = Buffer.alloc(3);
    b[0] = 0xfd;
    b.writeUInt16LE(Number(value), 1);
    return b;
  }
  if (value <= 0xffffffffn) {
    const b = Buffer.alloc(5);
    b[0] = 0xfe;
    b.writeUInt32LE(Number(value), 1);
    return b;
  }
  const b = Buffer.alloc(9);
  b[0] = 0xff;
  b.writeBigUInt64LE(value, 1);
  return b;
}

function decodeVarInt(
  payload: Buffer,
  offset: number
): { value: bigint; next: number } | null {
  if (offset >= payload.length) return null;
  const first = payload[offset];
  if (first < 0xfd) {
    return { value: BigInt(first), next: offset + 1 };
  }
  if (first === 0xfd) {
    if (offset + 3 > payload.length) return null;
    return { value: BigInt(payload.readUInt16LE(offset + 1)), next: offset + 3 };
  }
  if (first === 0xfe) {
    if (offset + 5 > payload.length) return null;
    return { value: BigInt(payload.readUInt32LE(offset + 1)), next: offset + 5 };
  }
  if (offset + 9 > payload.length) return null;
  return { value: payload.readBigUInt64LE(offset + 1), next: offset + 9 };
}

function ipv6StringToBuffer(ip: string): Buffer | null {
  const parts = ip.toLowerCase().split("::");
  if (parts.length > 2) return null;

  const parseSegment = (segment: string): number[] => {
    if (!segment) return [];
    return segment.split(":").map((part) => {
      if (!part) return 0;
      const value = Number.parseInt(part, 16);
      return Number.isFinite(value) ? value : -1;
    });
  };

  const left = parseSegment(parts[0]);
  const right = parseSegment(parts[1] ?? "");
  if (left.some((v) => v < 0 || v > 0xffff) || right.some((v) => v < 0 || v > 0xffff)) {
    return null;
  }

  let groups: number[] = [];
  if (parts.length === 1) {
    if (left.length !== 8) return null;
    groups = left;
  } else {
    const zeroFill = 8 - left.length - right.length;
    if (zeroFill < 0) return null;
    groups = [...left, ...Array.from({ length: zeroFill }, () => 0), ...right];
  }

  if (groups.length !== 8) return null;
  const out = Buffer.alloc(16);
  for (let i = 0; i < groups.length; i++) {
    out.writeUInt16BE(groups[i], i * 2);
  }
  return out;
}

function ipToNetAddrBuffer(ip: string): Buffer {
  if (net.isIP(ip) === 4) {
    const out = Buffer.alloc(16);
    out.fill(0, 0, 10);
    out[10] = 0xff;
    out[11] = 0xff;
    const octets = ip.split(".").map((x) => Number.parseInt(x, 10));
    for (let i = 0; i < 4; i++) {
      out[12 + i] = Number.isFinite(octets[i]) ? octets[i] & 0xff : 0;
    }
    return out;
  }

  if (net.isIP(ip) === 6) {
    const parsed = ipv6StringToBuffer(ip);
    if (parsed) return parsed;
  }

  return Buffer.alloc(16);
}

function decodeIpFromNetAddr(buffer: Buffer): string {
  const isV4Mapped =
    buffer.subarray(0, 10).every((b) => b === 0) &&
    buffer[10] === 0xff &&
    buffer[11] === 0xff;
  if (isV4Mapped) {
    return `${buffer[12]}.${buffer[13]}.${buffer[14]}.${buffer[15]}`;
  }

  const groups: string[] = [];
  for (let i = 0; i < 8; i++) {
    groups.push(buffer.readUInt16BE(i * 2).toString(16));
  }
  return groups.join(":");
}

function encodeP2pMessage(
  magic: Uint8Array,
  command: string,
  payloadBytes: Uint8Array
): Buffer {
  const payload = Buffer.from(payloadBytes);
  const magicBuf = Buffer.from(magic);
  const commandBuf = Buffer.alloc(P2P_COMMAND_BYTES);
  commandBuf.write(command.slice(0, P2P_COMMAND_BYTES), "ascii");

  const header = Buffer.alloc(P2P_HEADER_BYTES);
  magicBuf.copy(header, 0, 0, 4);
  commandBuf.copy(header, 4);
  header.writeUInt32LE(payload.length, 16);
  sha256d(payload).subarray(0, 4).copy(header, 20);

  return Buffer.concat([header, payload]);
}

function parseP2pMessages(
  input: Buffer,
  expectedMagic: Uint8Array
): { remaining: Buffer; messages: ParsedMessage[] } {
  const expectedMagicBuf = Buffer.from(expectedMagic);
  let offset = 0;
  const messages: ParsedMessage[] = [];

  while (offset + P2P_HEADER_BYTES <= input.length) {
    const magic = input.subarray(offset, offset + 4);
    if (!magic.equals(expectedMagicBuf)) {
      break;
    }

    const commandRaw = input.subarray(offset + 4, offset + 16);
    const command = commandRaw.toString("ascii").replace(/\0+$/, "");
    const length = input.readUInt32LE(offset + 16);
    const checksum = input.subarray(offset + 20, offset + 24);
    if (length > P2P_MAX_PAYLOAD_BYTES) {
      throw new Error(`P2P payload too large: ${length}`);
    }

    const end = offset + P2P_HEADER_BYTES + length;
    if (end > input.length) break;

    const payload = input.subarray(offset + P2P_HEADER_BYTES, end);
    const payloadChecksum = sha256d(payload).subarray(0, 4);
    if (checksum.equals(payloadChecksum)) {
      messages.push({ command, payload: Buffer.from(payload) });
    }

    offset = end;
  }

  return { remaining: input.subarray(offset), messages };
}

function buildVersionPayload(host: string, port: number): Buffer {
  const protocolVersion = Buffer.alloc(4);
  protocolVersion.writeInt32LE(P2P_PROTOCOL_VERSION, 0);

  const services = Buffer.alloc(8);
  services.writeBigUInt64LE(0n, 0);

  const timestamp = Buffer.alloc(8);
  timestamp.writeBigInt64LE(BigInt(Math.floor(Date.now() / 1000)), 0);

  const addrRecvServices = Buffer.alloc(8);
  addrRecvServices.writeBigUInt64LE(0n, 0);
  const addrRecvIp = ipToNetAddrBuffer(host);
  const addrRecvPort = Buffer.alloc(2);
  addrRecvPort.writeUInt16BE(port, 0);

  const addrFromServices = Buffer.alloc(8);
  addrFromServices.writeBigUInt64LE(0n, 0);
  const addrFromIp = ipToNetAddrBuffer("127.0.0.1");
  const addrFromPort = Buffer.alloc(2);
  addrFromPort.writeUInt16BE(0, 0);

  const nonce = crypto.randomBytes(8);
  const userAgent = Buffer.from("/navio-blocks-p2p:0.1.0/", "utf8");
  const userAgentLen = encodeVarInt(BigInt(userAgent.length));

  const startHeight = Buffer.alloc(4);
  startHeight.writeInt32LE(0, 0);
  const relay = Buffer.from([0]);

  return Buffer.concat([
    protocolVersion,
    services,
    timestamp,
    addrRecvServices,
    addrRecvIp,
    addrRecvPort,
    addrFromServices,
    addrFromIp,
    addrFromPort,
    nonce,
    userAgentLen,
    userAgent,
    startHeight,
    relay,
  ]);
}

function parseAddrPayload(payload: Buffer): KnownNodeAddress[] {
  const countVar = decodeVarInt(payload, 0);
  if (!countVar) return [];

  const out: KnownNodeAddress[] = [];
  let offset = countVar.next;
  const count = Number(
    countVar.value > BigInt(P2P_MAX_ADDRS_PER_PEER)
      ? BigInt(P2P_MAX_ADDRS_PER_PEER)
      : countVar.value
  );

  for (let i = 0; i < count; i++) {
    if (offset + 30 > payload.length) break;
    const time = payload.readUInt32LE(offset);
    offset += 4;

    const services = payload.readBigUInt64LE(offset);
    offset += 8;

    const ip = decodeIpFromNetAddr(payload.subarray(offset, offset + 16));
    offset += 16;

    const port = payload.readUInt16BE(offset);
    offset += 2;

    if (!ip || port <= 0 || port > 65535) continue;
    out.push({
      address: ip,
      port,
      services: services.toString(),
      time,
    });
  }

  return out;
}

function parseAddrV2Payload(payload: Buffer): KnownNodeAddress[] {
  const countVar = decodeVarInt(payload, 0);
  if (!countVar) return [];

  const out: KnownNodeAddress[] = [];
  let offset = countVar.next;
  const count = Number(
    countVar.value > BigInt(P2P_MAX_ADDRS_PER_PEER)
      ? BigInt(P2P_MAX_ADDRS_PER_PEER)
      : countVar.value
  );

  for (let i = 0; i < count; i++) {
    if (offset + 5 > payload.length) break;
    const time = payload.readUInt32LE(offset);
    offset += 4;

    const servicesVar = decodeVarInt(payload, offset);
    if (!servicesVar) break;
    const services = servicesVar.value.toString();
    offset = servicesVar.next;

    if (offset + 1 > payload.length) break;
    const networkId = payload[offset];
    offset += 1;

    const addrLenVar = decodeVarInt(payload, offset);
    if (!addrLenVar) break;
    const addrLen = Number(addrLenVar.value);
    offset = addrLenVar.next;

    if (offset + addrLen + 2 > payload.length) break;
    const rawAddr = payload.subarray(offset, offset + addrLen);
    offset += addrLen;

    const port = payload.readUInt16BE(offset);
    offset += 2;

    let ip = "";
    if (networkId === 1 && rawAddr.length === 4) {
      ip = `${rawAddr[0]}.${rawAddr[1]}.${rawAddr[2]}.${rawAddr[3]}`;
    } else if (networkId === 2 && rawAddr.length === 16) {
      ip = decodeIpFromNetAddr(rawAddr);
    } else {
      continue;
    }

    if (!ip || port <= 0 || port > 65535) continue;
    out.push({
      address: ip,
      port,
      services,
      time,
    });
  }

  return out;
}

function parseVersionSubversion(payload: Buffer): string {
  if (payload.length < 80) return "";
  const userAgentVar = decodeVarInt(payload, 80);
  if (!userAgentVar) return "";
  const length = Number(userAgentVar.value);
  if (userAgentVar.next + length > payload.length) return "";
  return payload.subarray(userAgentVar.next, userAgentVar.next + length).toString("utf8");
}

async function queryPeerAddressesP2P(
  host: string,
  port: number,
  magic: Uint8Array
): Promise<P2PCrawlResult> {
  return await new Promise<P2PCrawlResult>((resolve) => {
    const socket = net.createConnection({ host, port });
    let recv: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    let reachable = false;
    let handshake = false;
    let sentVerack = false;
    let sentGetAddr = false;
    let settled = false;
    const discovered = new Map<string, KnownNodeAddress>();

    const finish = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve({
        reachable,
        handshake,
        addresses: Array.from(discovered.values()),
      });
    };

    const timer = setTimeout(() => finish(), P2P_REQUEST_TIMEOUT_MS);

    const send = (
      command: string,
      payload: Uint8Array = new Uint8Array(0)
    ): void => {
      socket.write(encodeP2pMessage(magic, command, payload));
    };

    const ingest = (entries: KnownNodeAddress[]): void => {
      for (const entry of entries) {
        const ip = entry.address;
        if (!isRoutableIp(ip)) continue;
        const key = formatAddress(ip, entry.port);
        const existing = discovered.get(key);
        if (!existing) {
          discovered.set(key, entry);
          continue;
        }
        const shouldReplace =
          entry.time > existing.time ||
          (existing.services.length === 0 && entry.services.length > 0);
        if (shouldReplace) discovered.set(key, entry);
      }
    };

    socket.once("connect", () => {
      reachable = true;
      send("version", buildVersionPayload(host, port));
    });

    socket.on("data", (chunk: Buffer | string) => {
      const chunkBuf =
        typeof chunk === "string" ? Buffer.from(chunk, "binary") : Buffer.from(chunk);
      recv = Buffer.concat([recv, chunkBuf]);
      let parsed;
      try {
        parsed = parseP2pMessages(recv, magic);
      } catch {
        finish();
        return;
      }
      recv = parsed.remaining;

      for (const msg of parsed.messages) {
        if (msg.command === "version") {
          handshake = true;
          if (!sentVerack) {
            send("verack");
            sentVerack = true;
          }
          if (!sentGetAddr) {
            send("getaddr");
            sentGetAddr = true;
          }

          const subversion = parseVersionSubversion(msg.payload);
          if (subversion) {
            // Stash subversion as a synthetic service tag for later enrichment.
            const key = formatAddress(host, port);
            const existing = discovered.get(key);
            if (existing) {
              existing.services = withReachabilityTag(
                `${existing.services},subver=${subversion}`,
                undefined
              );
              discovered.set(key, existing);
            }
          }
        } else if (msg.command === "verack") {
          handshake = true;
          if (!sentGetAddr) {
            send("getaddr");
            sentGetAddr = true;
          }
        } else if (msg.command === "ping") {
          send("pong", msg.payload);
        } else if (msg.command === "addr") {
          ingest(parseAddrPayload(msg.payload));
        } else if (msg.command === "addrv2") {
          ingest(parseAddrV2Payload(msg.payload));
        }
      }
    });

    socket.once("timeout", () => finish());
    socket.once("error", () => finish());
    socket.once("close", () => finish());
    socket.setTimeout(P2P_REQUEST_TIMEOUT_MS);
  });
}

async function resolveSeedEndpoints(
  network: NetworkType
): Promise<SeedEndpoint[]> {
  const seeds = resolveBootstrapNodes(network);
  const defaultPort = getDefaultP2pPort(network);
  const endpoints = new Map<string, SeedEndpoint>();

  for (const seed of seeds) {
    const parsed = parseSeedEntry(seed, defaultPort);
    if (!parsed) {
      console.warn(`[peers] Ignoring invalid bootstrap node: ${seed}`);
      continue;
    }

    const key = formatAddress(parsed.host, parsed.port);
    endpoints.set(key, parsed);

    if (net.isIP(parsed.host) !== 0) continue;

    try {
      const resolved = await lookup(parsed.host, { all: true, verbatim: false });
      for (const addr of resolved) {
        if (net.isIP(addr.address) === 0) continue;
        const ipKey = formatAddress(addr.address, parsed.port);
        endpoints.set(ipKey, { host: addr.address, port: parsed.port });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[peers] DNS resolve failed for seed ${parsed.host}: ${message}`);
    }
  }

  return Array.from(endpoints.values());
}

async function mapLimit<T, R>(
  values: T[],
  concurrency: number,
  worker: (value: T) => Promise<R>
): Promise<R[]> {
  if (values.length === 0) return [];
  const results: R[] = new Array(values.length);
  const limit = Math.max(1, Math.min(concurrency, values.length));
  let index = 0;

  const runners = Array.from({ length: limit }, async () => {
    while (true) {
      const current = index;
      index += 1;
      if (current >= values.length) break;
      results[current] = await worker(values[current]);
    }
  });

  await Promise.all(runners);
  return results;
}

async function crawlPeersViaP2P(
  network: NetworkType
): Promise<{ known: KnownNodeAddress[]; crawlReachable: number }> {
  const magic = getNetworkMagic(network);
  const seeds = await resolveSeedEndpoints(network);
  if (seeds.length === 0) {
    console.warn("[peers] No bootstrap nodes configured for P2P crawl");
    return { known: [], crawlReachable: 0 };
  }

  const queue: SeedEndpoint[] = [...seeds];
  const queued = new Set(queue.map((endpoint) => formatAddress(endpoint.host, endpoint.port)));
  const attempted = new Set<string>();
  const known = new Map<string, KnownNodeAddress>();
  let crawlReachable = 0;

  const ingestKnown = (entry: KnownNodeAddress): void => {
    const key = formatAddress(entry.address, entry.port);
    const existing = known.get(key);
    if (!existing) {
      if (known.size >= PEER_DISCOVERY_MAX_CANDIDATES) return;
      known.set(key, entry);
      return;
    }
    const shouldReplace =
      entry.time > existing.time ||
      (existing.services.length === 0 && entry.services.length > 0);
    if (shouldReplace) known.set(key, entry);
  };

  for (let round = 1; round <= PEER_DISCOVERY_ROUNDS; round++) {
    if (queue.length === 0) break;

    const batch: SeedEndpoint[] = [];
    while (batch.length < PEER_DISCOVERY_BATCH_SIZE && queue.length > 0) {
      const endpoint = queue.shift();
      if (!endpoint) continue;
      const key = formatAddress(endpoint.host, endpoint.port);
      queued.delete(key);
      if (attempted.has(key)) continue;
      attempted.add(key);
      batch.push(endpoint);
    }

    if (batch.length === 0) break;

    const results = await mapLimit(batch, P2P_CRAWL_CONCURRENCY, async (endpoint) => {
      const result = await queryPeerAddressesP2P(endpoint.host, endpoint.port, magic);
      return { endpoint, result };
    });

    let roundReachable = 0;
    let roundDiscovered = 0;

    for (const { endpoint, result } of results) {
      if (result.reachable) {
        roundReachable++;
        crawlReachable++;
      }

      if (net.isIP(endpoint.host) !== 0) {
        ingestKnown({
          address: endpoint.host,
          port: endpoint.port,
          services: withReachabilityTag("", result.reachable),
          time: Math.floor(Date.now() / 1000),
        });
      }

      for (const addr of result.addresses) {
        const key = formatAddress(addr.address, addr.port);
        const hadBefore = known.has(key);
        ingestKnown(addr);
        if (!hadBefore && known.has(key)) roundDiscovered++;

        if (known.size >= PEER_DISCOVERY_MAX_CANDIDATES) continue;
        if (queued.has(key) || attempted.has(key)) continue;

        queue.push({ host: addr.address, port: addr.port });
        queued.add(key);
      }
    }

    console.log(
      `[peers] P2P crawl round ${round}/${PEER_DISCOVERY_ROUNDS}: probed=${batch.length}, reachable=${roundReachable}, new=${roundDiscovered}, known=${known.size}, queue=${queue.length}`
    );

    if (round < PEER_DISCOVERY_ROUNDS) {
      await sleep(PEER_DISCOVERY_WAIT_MS);
    }
  }

  console.log(
    `[peers] P2P crawl complete: attempted=${attempted.size}, reachable=${crawlReachable}, known=${known.size}`
  );

  return { known: Array.from(known.values()), crawlReachable };
}

export async function updatePeers(
  rpc: RpcClient,
  queries: Queries,
  network: NetworkType = "mainnet"
): Promise<void> {
  try {
    const now = Math.floor(Date.now() / 1000);
    const seenAddrs = new Set<string>();
    let geoApiLookups = 0;

    const geolocateIfAllowed = async (ip: string): Promise<IpApiResponse> => {
      if (!isRoutableIp(ip)) return {};

      const existing = geoCache.get(ip);
      if (existing && existing.expiresAt > Date.now()) return existing.geo;

      if (geoApiLookups >= PEER_GEO_LOOKUP_LIMIT) return {};
      geoApiLookups++;

      const geo = await geolocateCached(ip);
      if (geoApiLookups < PEER_GEO_LOOKUP_LIMIT) {
        await sleep(IP_API_RATE_LIMIT_MS);
      }
      return geo;
    };

    // 1) Direct peers from local node RPC.
    const rpcPeers = (await rpc.getPeerInfo()) as Record<string, unknown>[];
    console.log(`[peers] Direct peers: ${rpcPeers.length}`);

    for (const rp of rpcPeers) {
      const peerId = toNumberSafe(rp.id, NaN);
      if (!Number.isFinite(peerId)) continue;

      const addr = toStringSafe(rp.addr, "");
      if (!addr) continue;
      seenAddrs.add(addr);

      const ip = extractIp(addr);
      const geo = await geolocateIfAllowed(ip);

      const connTime = toNumberSafe(rp.conntime, now);
      const servicesNames = rp.servicesnames;
      const rawServices =
        Array.isArray(servicesNames) && servicesNames.length > 0
          ? servicesNames.map((v) => toStringSafe(v)).join(",")
          : toStringSafe(servicesNames, toStringSafe(rp.services, ""));

      const peer: Peer = {
        id: peerId,
        addr,
        subversion: toStringSafe(rp.subver, ""),
        services: withReachabilityTag(rawServices, true),
        country: toStringSafe(geo.country, "") || undefined,
        city: toStringSafe(geo.city, "") || undefined,
        lat: toOptionalNumberSafe(geo.lat),
        lon: toOptionalNumberSafe(geo.lon),
        last_seen: now,
        first_seen: connTime,
      };

      queries.upsertPeer(peer);
    }

    // 2) Seeder-style direct P2P discovery (no RPC addnode/getnodeaddresses dependency).
    const { known: discoveredPeers, crawlReachable } = await crawlPeersViaP2P(network);

    const undiscovered = discoveredPeers
      .map((entry) => ({ entry, addr: formatAddress(entry.address, entry.port) }))
      .filter(({ addr }) => !seenAddrs.has(addr))
      .sort((a, b) => b.entry.time - a.entry.time);

    const probeTargets = undiscovered
      .slice(0, PEER_CONNECT_TEST_LIMIT)
      .map(({ addr }) => addr);
    const testedSet = new Set(probeTargets);
    const connectivity = await probeReachability(probeTargets);
    const reachableCount = probeTargets.reduce(
      (count, addr) => count + (connectivity.get(addr) ? 1 : 0),
      0
    );

    if (probeTargets.length > 0) {
      console.log(
        `[peers] Connectivity probes: reachable=${reachableCount}/${probeTargets.length} (timeout=${PEER_CONNECT_TIMEOUT_MS}ms, concurrency=${PEER_CONNECT_CONCURRENCY})`
      );
    }

    let added = 0;
    let skippedUnreachable = 0;
    for (const { entry, addr } of undiscovered) {
      const tested = testedSet.has(addr);
      const reachable = tested ? connectivity.get(addr) : undefined;

      if (
        network === "testnet" &&
        PEER_DISCOVERY_FILTER_UNREACHABLE &&
        tested &&
        reachable === false
      ) {
        skippedUnreachable++;
        continue;
      }

      seenAddrs.add(addr);
      const geo = await geolocateIfAllowed(entry.address);
      const lastSeen = toNumberSafe(entry.time, now);

      const peer: Peer = {
        id: stableDiscoveredPeerId(addr),
        addr,
        subversion: "",
        services: withReachabilityTag(entry.services, reachable),
        country: toStringSafe(geo.country, "") || undefined,
        city: toStringSafe(geo.city, "") || undefined,
        lat: toOptionalNumberSafe(geo.lat),
        lon: toOptionalNumberSafe(geo.lon),
        last_seen: lastSeen,
        first_seen: lastSeen,
      };

      queries.upsertPeer(peer);
      added++;
    }

    console.log(
      `[peers] Discovered ${added} additional peers from direct P2P crawl (${discoveredPeers.length} known, crawl reachable ${crawlReachable}, skipped ${skippedUnreachable})`
    );

    queries.compactPeersByAddress();

    const cutoff = now - 7 * 24 * 60 * 60;
    queries.deleteOldPeers(cutoff);

    console.log(`[peers] Peer update complete, ${seenAddrs.size} total addresses`);
  } catch (err) {
    console.error("[peers] Error updating peers:", err);
  }
}
