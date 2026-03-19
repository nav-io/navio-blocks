import * as crypto from "node:crypto";
import type { Block, Transaction, Output, Input, NetworkType, OutputType } from "@navio-blocks/shared";
import { getExpectedBlockReward } from "./supply.js";

interface BlockFees {
  block_reward: number;   // new coins minted (subsidy/fixed reward) in satoshis
  fees_burned: number;    // fees burned via OP_RETURN in BLSCT txs, in satoshis
  fees_collected: number; // fees collected by miner in PoW blocks, in satoshis
}

export interface TokenCollectionRecord {
  token_id: string;
  token_type: "token" | "nft" | "unknown";
  public_key?: string;
  max_supply?: number;
  metadata_json?: string;
  create_txid: string;
  create_output_hash: string;
  create_height: number;
  create_timestamp: number;
}

export interface NftItemRecord {
  token_id: string;
  nft_index: string;
  nft_id: string;
  metadata_json?: string;
  mint_txid: string;
  mint_output_hash: string;
  mint_height: number;
  mint_timestamp: number;
}

interface ParsedBlock {
  block: Block;
  transactions: Transaction[];
  outputs: Output[];
  inputs: Input[];
  token_collections: TokenCollectionRecord[];
  nft_items: NftItemRecord[];
  fees: BlockFees;
}

function isBlsctOutput(vout: Record<string, unknown>): boolean {
  if (vout.rangeproof || vout.rangeProof) return true;
  if (vout.spending_key || vout.spendingKey) return true;
  if (vout.ephemeral_key || vout.ephemeralKey) return true;
  if (vout.blinding_key || vout.blindingKey) return true;
  if (vout.view_tag || vout.viewTag) return true;

  const spk = vout.scriptPubKey as Record<string, unknown> | undefined;
  if (spk) {
    if (spk.spending_key || spk.spendingKey) return true;
    if (spk.ephemeral_key || spk.ephemeralKey) return true;
    if (spk.blinding_key || spk.blindingKey) return true;
    if (spk.view_tag || spk.viewTag) return true;
    const type = spk.type as string | undefined;
    if (type === "blsct") return true;
  }
  return false;
}

function hasTokenFields(vout: Record<string, unknown>): boolean {
  if (vout.token || vout.tokenId || vout.token_id || vout.tokenid) return true;
  const spk = vout.scriptPubKey as Record<string, unknown> | undefined;
  if (spk && (spk.token || spk.tokenId || spk.token_id || spk.tokenid)) return true;
  return false;
}

function extractBlsctFields(vout: Record<string, unknown>): {
  spending_key?: string;
  ephemeral_key?: string;
  blinding_key?: string;
  view_tag?: string;
} {
  const spk = vout.scriptPubKey as Record<string, unknown> | undefined;
  return {
    spending_key:
      (vout.spending_key as string) ??
      (vout.spendingKey as string) ??
      (spk?.spending_key as string) ??
      (spk?.spendingKey as string) ??
      undefined,
    ephemeral_key:
      (vout.ephemeral_key as string) ??
      (vout.ephemeralKey as string) ??
      (spk?.ephemeral_key as string) ??
      (spk?.ephemeralKey as string) ??
      undefined,
    blinding_key:
      (vout.blinding_key as string) ??
      (vout.blindingKey as string) ??
      (spk?.blinding_key as string) ??
      (spk?.blindingKey as string) ??
      undefined,
    view_tag:
      (vout.view_tag as string) ??
      (typeof vout.viewTag === "number" ? String(vout.viewTag) : (vout.viewTag as string | undefined)) ??
      (spk?.view_tag as string) ??
      (typeof spk?.viewTag === "number" ? String(spk.viewTag) : (spk?.viewTag as string | undefined)) ??
      undefined,
  };
}

function extractAddress(vout: Record<string, unknown>): string | undefined {
  const spk = vout.scriptPubKey as Record<string, unknown> | undefined;
  if (!spk) return undefined;

  if (typeof spk.address === "string") return spk.address;

  const addresses = spk.addresses as string[] | undefined;
  if (addresses && addresses.length > 0) return addresses[0];

  return undefined;
}

function satoshis(btcValue: unknown): number {
  if (typeof btcValue === "number") {
    return Math.round(btcValue * 1e8);
  }
  return 0;
}

function toRawJson(value: unknown): string | null {
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function extractTokenId(rpcVout: Record<string, unknown>): string | undefined {
  // tokenId can be on the vout directly or inside scriptPubKey
  const candidates: unknown[] = [
    rpcVout.tokenId,
    rpcVout.token_id,
    rpcVout.tokenid,
    (rpcVout.scriptPubKey as Record<string, unknown> | undefined)?.tokenId,
    (rpcVout.scriptPubKey as Record<string, unknown> | undefined)?.token_id,
    (rpcVout.scriptPubKey as Record<string, unknown> | undefined)?.tokenid,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim().length > 0) return c.trim().toLowerCase();
  }
  return undefined;
}

function extractSpkFields(rpcVout: Record<string, unknown>): {
  spk_type?: string;
  spk_hex?: string;
  spk_asm?: string;
} {
  const spk = rpcVout.scriptPubKey as Record<string, unknown> | undefined;
  if (!spk) return {};
  let spk_type = typeof spk.type === "string" ? spk.type : undefined;
  const spk_hex = typeof spk.hex === "string" ? spk.hex : undefined;
  // OP_TRUE (0x51) is a standard script in Navcoin PoS; don't label as nonstandard
  if (spk_type === "nonstandard" && spk_hex === "51") {
    spk_type = "op_true";
  }
  if (spk_type === "nulldata") {
    spk_type = "unspendable";
  }
  return {
    spk_type,
    spk_hex,
    spk_asm: typeof spk.asm === "string" ? spk.asm : undefined,
  };
}

const NATIVE_TOKEN_ID = "0000000000000000000000000000000000000000000000000000000000000000";

function isNativeTokenId(tokenId: string | undefined): boolean {
  if (!tokenId) return false;
  return tokenId.replace(/#.*$/, "") === NATIVE_TOKEN_ID;
}

function extractTokenParts(tokenId: string): { base: string; nftIndex?: string } {
  const hashIndex = tokenId.indexOf("#");
  if (hashIndex < 0) return { base: tokenId };
  const base = tokenId.slice(0, hashIndex);
  const nftIndex = tokenId.slice(hashIndex + 1);
  return { base, nftIndex: nftIndex.length > 0 ? nftIndex : undefined };
}

function normalizeTokenType(raw: unknown): "token" | "nft" | "unknown" | undefined {
  if (typeof raw === "number") {
    if (raw === 0) return "token";
    if (raw === 1) return "nft";
    return "unknown";
  }
  if (typeof raw === "string") {
    const lowered = raw.trim().toLowerCase();
    if (lowered === "0" || lowered === "token") return "token";
    if (lowered === "1" || lowered === "nft") return "nft";
    return "unknown";
  }
  return undefined;
}

interface DecodedPredicate {
  op: number;
  token_type?: "token" | "nft" | "unknown";
  public_key_hex?: string;
  max_supply?: number;
  amount?: string;
  metadata?: Record<string, string>;
  nft_id?: string;
  nft_metadata?: Record<string, string>;
}

function normalizeHexString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase().replace(/^0x/, "");
  if (normalized.length === 0 || normalized.length % 2 !== 0) return undefined;
  if (!/^[0-9a-f]+$/.test(normalized)) return undefined;
  return normalized;
}

function sha256d(bytes: Uint8Array): Buffer {
  const first = crypto.createHash("sha256").update(bytes).digest();
  return crypto.createHash("sha256").update(first).digest();
}

function tokenIdFromPublicKeyHex(publicKeyHex: string | undefined): string | undefined {
  const normalized = normalizeHexString(publicKeyHex);
  if (!normalized) return undefined;
  const hash = sha256d(Buffer.from(normalized, "hex"));
  return Buffer.from(hash).reverse().toString("hex");
}

function deriveTokenIdFromPredicate(
  tokenId: string | undefined,
  predicate: DecodedPredicate | undefined
): string | undefined {
  if (!predicate) return tokenId;
  if (predicate.op !== 0 && predicate.op !== 1 && predicate.op !== 2) {
    return tokenId;
  }
  if (tokenId && !isNativeTokenId(tokenId)) return tokenId;

  const base = tokenIdFromPublicKeyHex(predicate.public_key_hex);
  if (!base) return tokenId;
  if (predicate.op === 2 && predicate.nft_id) {
    return `${base}#${predicate.nft_id}`;
  }
  return base;
}

function sanitizeTokenIdForOutput(
  tokenId: string | undefined,
  predicate: DecodedPredicate | undefined,
  outputType: OutputType,
): string | undefined {
  if (!tokenId) return tokenId;
  if (outputType === "fee") return undefined;
  if (predicate?.op === 3 || predicate?.op === 4) return undefined;
  return tokenId;
}

function predicateOpToLabel(op: number | undefined): string | undefined {
  switch (op) {
    case 0:
      return "CREATE_TOKEN";
    case 1:
      return "MINT_TOKEN";
    case 2:
      return "MINT_NFT";
    case 3:
      return "PAY_FEE";
    case 4:
      return "DATA";
    default:
      return undefined;
  }
}

function predicateArgsFromDecoded(
  predicate: DecodedPredicate | undefined
): Record<string, unknown> | undefined {
  if (!predicate) return undefined;

  const args: Record<string, unknown> = {};
  if (predicate.public_key_hex) args.public_key = predicate.public_key_hex;
  if (predicate.token_type) args.token_type = predicate.token_type;
  if (predicate.max_supply != null) args.max_supply = predicate.max_supply;
  if (predicate.amount != null) args.amount = predicate.amount;
  if (predicate.nft_id != null) args.nft_id = predicate.nft_id;
  if (predicate.metadata && Object.keys(predicate.metadata).length > 0) {
    args.metadata = predicate.metadata;
  }
  if (predicate.nft_metadata && Object.keys(predicate.nft_metadata).length > 0) {
    args.nft_metadata = predicate.nft_metadata;
  }

  return Object.keys(args).length > 0 ? args : undefined;
}

const INT64_MAX = 9223372036854775807n;
const UINT64_MAX = 18446744073709551615n;
const UINT32_MAX = 4294967295n;

const TXOUT_BLSCT_MARKER = 1n << 0n;
const TXOUT_TOKEN_MARKER = 1n << 1n;
const TXOUT_PREDICATE_MARKER = 1n << 2n;
const TXOUT_TRANSPARENT_VALUE_MARKER = 1n << 3n;

const MCL_G1_SIZE = 48;
const MCL_SCALAR_SIZE = 32;
const UINT256_SIZE = 32;

class ByteReader {
  private offset = 0;

  constructor(private readonly bytes: Uint8Array) {}

  get remaining(): number {
    return this.bytes.length - this.offset;
  }

  private require(size: number): void {
    if (size < 0 || this.remaining < size) {
      throw new Error(`Unexpected end of data at ${this.offset} (+${size})`);
    }
  }

  readU8(): number {
    this.require(1);
    const value = this.bytes[this.offset];
    this.offset += 1;
    return value;
  }

  readU16LE(): number {
    this.require(2);
    const value = this.bytes[this.offset] | (this.bytes[this.offset + 1] << 8);
    this.offset += 2;
    return value;
  }

  readU32LE(): number {
    this.require(4);
    const value =
      this.bytes[this.offset] |
      (this.bytes[this.offset + 1] << 8) |
      (this.bytes[this.offset + 2] << 16) |
      (this.bytes[this.offset + 3] << 24);
    this.offset += 4;
    return value >>> 0;
  }

  readU64LE(): bigint {
    this.require(8);
    let value = 0n;
    for (let i = 0; i < 8; i++) {
      value |= BigInt(this.bytes[this.offset + i]) << BigInt(8 * i);
    }
    this.offset += 8;
    return value;
  }

  readI64LE(): bigint {
    const value = this.readU64LE();
    if ((value & (1n << 63n)) !== 0n) {
      return value - (1n << 64n);
    }
    return value;
  }

  readI64AsNumber(): number | undefined {
    const value = this.readI64LE();
    if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
      return undefined;
    }
    return Number(value);
  }

  readCompactSize(): bigint {
    const first = this.readU8();
    if (first < 253) return BigInt(first);
    if (first === 253) {
      const value = BigInt(this.readU16LE());
      if (value < 253n) throw new Error("Non-canonical compact size (16-bit)");
      return value;
    }
    if (first === 254) {
      const value = BigInt(this.readU32LE());
      if (value < 65536n) throw new Error("Non-canonical compact size (32-bit)");
      return value;
    }
    const value = this.readU64LE();
    if (value < UINT32_MAX + 1n) throw new Error("Non-canonical compact size (64-bit)");
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error("Compact size too large for JS number");
    }
    return value;
  }

  readBytes(size: number): Uint8Array {
    this.require(size);
    const out = this.bytes.slice(this.offset, this.offset + size);
    this.offset += size;
    return out;
  }

  readVarBytes(): Uint8Array {
    const size = Number(this.readCompactSize());
    return this.readBytes(size);
  }

  skip(size: number): void {
    this.require(size);
    this.offset += size;
  }
}

function decodeUtf8(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("utf8");
}

function parseStringMap(reader: ByteReader): Record<string, string> {
  const result: Record<string, string> = {};
  const size = Number(reader.readCompactSize());
  if (size > 10_000) throw new Error(`Unreasonable map size: ${size}`);

  for (let i = 0; i < size; i++) {
    const key = decodeUtf8(reader.readVarBytes());
    const value = decodeUtf8(reader.readVarBytes());
    if (key.length === 0) continue;
    result[key] = value;
  }

  return result;
}

function skipRangeProof(reader: ByteReader): void {
  const vsSize = Number(reader.readCompactSize());
  reader.skip(vsSize * MCL_G1_SIZE);
  if (vsSize > 0) {
    const lsSize = Number(reader.readCompactSize());
    reader.skip(lsSize * MCL_G1_SIZE);

    const rsSize = Number(reader.readCompactSize());
    reader.skip(rsSize * MCL_G1_SIZE);

    // A, A_wip, B
    reader.skip(MCL_G1_SIZE * 3);
    // r_prime, s_prime, delta_prime, alpha_hat, tau_x
    reader.skip(MCL_SCALAR_SIZE * 5);
  }
}

function skipBlsctData(reader: ByteReader): void {
  // CTxOutBLSCTData serialization in navio-core:
  // rangeProof, spendingKey, blindingKey, ephemeralKey, viewTag
  skipRangeProof(reader);
  reader.skip(MCL_G1_SIZE * 3);
  reader.skip(2);
}

function skipTokenId(reader: ByteReader): void {
  // TokenId = uint256 token + uint64 subid
  reader.skip(UINT256_SIZE);
  reader.skip(8);
}

function decodePredicate(predicateBytes: Uint8Array): DecodedPredicate | undefined {
  if (predicateBytes.length === 0) return undefined;

  try {
    const reader = new ByteReader(predicateBytes);
    const op = reader.readU8();

    if (op === 0) {
      // CREATE_TOKEN: op (u8), tokenInfo(type u8, publicKey, metadata map, nTotalSupply i64)
      const tokenType = normalizeTokenType(reader.readU8()) ?? "unknown";
      const publicKey = reader.readBytes(MCL_G1_SIZE);
      const metadata = parseStringMap(reader);
      const maxSupply = reader.readI64AsNumber();
      return {
        op,
        token_type: tokenType,
        public_key_hex: Buffer.from(publicKey).toString("hex"),
        metadata,
        max_supply: maxSupply,
      };
    }

    if (op === 1) {
      // MINT_TOKEN: op (u8), publicKey, amount(i64)
      const publicKey = reader.readBytes(MCL_G1_SIZE);
      const amount = reader.readI64LE();
      return {
        op,
        public_key_hex: Buffer.from(publicKey).toString("hex"),
        amount: amount.toString(),
      };
    }

    if (op === 2) {
      // MINT_NFT: op (u8), publicKey, nftId(u64), nftMetadata(map)
      const publicKey = reader.readBytes(MCL_G1_SIZE);
      const nftId = reader.readU64LE();
      const metadata = parseStringMap(reader);
      return {
        op,
        public_key_hex: Buffer.from(publicKey).toString("hex"),
        nft_id: nftId.toString(),
        nft_metadata: metadata,
      };
    }

    if (op === 3) {
      // PAY_FEE: op (u8), publicKey
      const publicKey = reader.readBytes(MCL_G1_SIZE);
      return {
        op,
        public_key_hex: Buffer.from(publicKey).toString("hex"),
      };
    }

    if (op === 4) {
      // DATA: op (u8), data(varbytes)
      reader.readVarBytes();
      return { op };
    }

    return { op };
  } catch {
    return undefined;
  }
}

function extractPredicateHex(rpcVout: Record<string, unknown>): string | undefined {
  const direct = rpcVout.predicateHex ?? rpcVout.predicate_hex;
  const normalizedDirect = normalizeHexString(direct);
  if (normalizedDirect) return normalizedDirect;
  const directFromPredicate = normalizeHexString(rpcVout.predicate);
  if (directFromPredicate) return directFromPredicate;

  const spk = rpcVout.scriptPubKey as Record<string, unknown> | undefined;
  const nested = spk?.predicateHex ?? spk?.predicate_hex;
  const normalizedNested = normalizeHexString(nested);
  if (normalizedNested) return normalizedNested;
  const nestedFromPredicate = normalizeHexString(spk?.predicate);
  if (nestedFromPredicate) return nestedFromPredicate;
  return undefined;
}

function extractPredicateLabel(rpcVout: Record<string, unknown>): string | undefined {
  if (typeof rpcVout.predicate === "string" && rpcVout.predicate.trim().length > 0) {
    return rpcVout.predicate.trim().toUpperCase();
  }

  const spk = rpcVout.scriptPubKey as Record<string, unknown> | undefined;
  if (typeof spk?.predicate === "string" && spk.predicate.trim().length > 0) {
    return spk.predicate.trim().toUpperCase();
  }

  return undefined;
}

function extractDecodedPredicateFromVout(rpcVout: Record<string, unknown>): DecodedPredicate | undefined {
  const predicateHex = extractPredicateHex(rpcVout);
  if (predicateHex) {
    try {
      return decodePredicate(new Uint8Array(Buffer.from(predicateHex, "hex")));
    } catch {
      return undefined;
    }
  }

  // Fallback: core also provides a human-friendly predicate label.
  const predicateLabel = extractPredicateLabel(rpcVout);
  if (!predicateLabel) return undefined;

  switch (predicateLabel) {
    case "CREATE_TOKEN":
      return { op: 0 };
    case "MINT":
    case "MINT_TOKEN":
      return { op: 1 };
    case "NFT_MINT":
    case "MINT_NFT":
      return { op: 2 };
    case "PAY_FEE":
      return { op: 3 };
    case "DATA":
      return { op: 4 };
    default:
      return undefined;
  }
}

function parsePredicatesByVoutFromTxHex(txHex: string): Map<number, DecodedPredicate> {
  const decoded = new Map<number, DecodedPredicate>();
  const normalizedTxHex = normalizeHexString(txHex);
  if (!normalizedTxHex) return decoded;

  try {
    const bytes = new Uint8Array(Buffer.from(normalizedTxHex, "hex"));
    const reader = new ByteReader(bytes);

    const version = reader.readU32LE();
    void version;

    let flags = 0;
    let vinCount = Number(reader.readCompactSize());

    if (vinCount === 0) {
      flags = reader.readU8();
      if (flags !== 0) {
        vinCount = Number(reader.readCompactSize());
      }
    }

    for (let i = 0; i < vinCount; i++) {
      // COutPoint hash only
      reader.skip(32);
      reader.readVarBytes(); // scriptSig
      reader.readU32LE(); // nSequence
    }

    const voutCount = Number(reader.readCompactSize());
    for (let i = 0; i < voutCount; i++) {
      let valueOrMarker = reader.readI64LE();
      let txOutFlags = 0n;

      if (valueOrMarker === INT64_MAX) {
        txOutFlags = reader.readU64LE();
        if ((txOutFlags & TXOUT_TRANSPARENT_VALUE_MARKER) !== 0n) {
          valueOrMarker = reader.readI64LE();
          void valueOrMarker;
        }
      }

      reader.readVarBytes(); // scriptPubKey

      if ((txOutFlags & TXOUT_BLSCT_MARKER) !== 0n) {
        skipBlsctData(reader);
      }
      if ((txOutFlags & TXOUT_TOKEN_MARKER) !== 0n) {
        skipTokenId(reader);
      }
      if ((txOutFlags & TXOUT_PREDICATE_MARKER) !== 0n) {
        const predicateBytes = reader.readVarBytes();
        const predicate = decodePredicate(predicateBytes);
        if (predicate) {
          decoded.set(i, predicate);
        }
      }
    }

    // Witness stack data if present in transaction serialization.
    if ((flags & 1) !== 0) {
      for (let i = 0; i < vinCount; i++) {
        const stackSize = Number(reader.readCompactSize());
        for (let j = 0; j < stackSize; j++) {
          reader.readVarBytes();
        }
      }
    }

    // nLockTime
    if (reader.remaining >= 4) {
      reader.readU32LE();
    }
  } catch {
    // Invalid or unsupported tx serialization — just return empty mapping.
    return decoded;
  }

  return decoded;
}

function extractMetadataMap(raw: Record<string, string> | undefined): Record<string, string> {
  if (!raw) return {};
  return raw;
}

function encodeMetadataJson(metadata: Record<string, string>): string | undefined {
  if (Object.keys(metadata).length === 0) return undefined;
  try {
    return JSON.stringify(metadata);
  } catch {
    return undefined;
  }
}

function extractTokenCollectionRecord(
  outputType: OutputType,
  tokenId: string | undefined,
  predicate: DecodedPredicate | undefined,
  txid: string,
  outputHash: string,
  blockHeight: number,
  blockTimestamp: number,
): TokenCollectionRecord | undefined {
  if (outputType !== "token_create" && outputType !== "nft_create") return undefined;

  const effectiveTokenId = !tokenId || isNativeTokenId(tokenId)
    ? tokenIdFromPublicKeyHex(predicate?.public_key_hex)
    : tokenId;
  if (!effectiveTokenId) return undefined;

  const { base } = extractTokenParts(effectiveTokenId);
  if (!base) return undefined;

  const tokenType =
    normalizeTokenType(predicate?.token_type) ??
    (outputType === "nft_create" ? "nft" : "token");

  const publicKey = predicate?.public_key_hex;
  const maxSupply = predicate?.max_supply;
  const metadata = extractMetadataMap(predicate?.metadata);

  return {
    token_id: base,
    token_type: tokenType ?? "unknown",
    public_key: publicKey,
    max_supply: maxSupply,
    metadata_json: encodeMetadataJson(metadata),
    create_txid: txid,
    create_output_hash: outputHash,
    create_height: blockHeight,
    create_timestamp: blockTimestamp,
  };
}

function extractNftItemRecord(
  outputType: OutputType,
  tokenId: string | undefined,
  predicate: DecodedPredicate | undefined,
  txid: string,
  outputHash: string,
  blockHeight: number,
  blockTimestamp: number,
): NftItemRecord | undefined {
  if (outputType !== "nft_mint") return undefined;

  const effectiveTokenId = !tokenId || isNativeTokenId(tokenId)
    ? tokenIdFromPublicKeyHex(predicate?.public_key_hex)
    : tokenId;
  if (!effectiveTokenId) return undefined;

  const tokenParts = extractTokenParts(effectiveTokenId);
  const base = tokenParts.base;
  const nftIndex =
    tokenParts.nftIndex ??
    predicate?.nft_id;

  if (!base || !nftIndex) return undefined;

  const metadata = extractMetadataMap(predicate?.nft_metadata);

  return {
    token_id: base,
    nft_index: nftIndex,
    nft_id: `${base}#${nftIndex}`,
    metadata_json: encodeMetadataJson(metadata),
    mint_txid: txid,
    mint_output_hash: outputHash,
    mint_height: blockHeight,
    mint_timestamp: blockTimestamp,
  };
}

function classifyOutputType(
  rpcVout: Record<string, unknown>,
  isCoinbaseTx: boolean,
  _isBlsct: boolean,
  tokenId: string | undefined,
  predicate: DecodedPredicate | undefined,
): OutputType {
  const { spk_type, spk_asm } = extractSpkFields(rpcVout);
  const val = satoshis(rpcVout.value);
  const op = predicate?.op;

  // 1. Coinbase tx outputs
  if (isCoinbaseTx) return "coinbase";

  // 2. Predicate-driven token operations and explicit fee/data predicates.
  if (op === 0) {
    const predicateType = predicate?.token_type;
    if (predicateType === "nft") return "nft_create";
    if (predicateType === "token") return "token_create";
    return tokenId?.includes("#") ? "nft_create" : "token_create";
  }
  if (op === 1) return "token_mint";
  if (op === 2) return "nft_mint";
  if (op === 3 || op === 4) return "fee";

  // 3. Fee output: unspendable OP_RETURN/fee script with value > 0.
  if ((spk_type === "unspendable" || spk_type === "nulldata" || spk_type === "fee") && val > 0) return "fee";

  // 4. Zero-value unspendable/fee script → fee (still unspendable)
  //    These are OP_RETURN data carriers; classify as fee (unspendable)
  if (spk_type === "unspendable" || spk_type === "nulldata" || spk_type === "fee") return "fee";

  // 5. Staking commitment
  if (spk_asm && spk_asm.startsWith("OP_STAKED_COMMITMENT")) return "stake";

  // 6. HTLC (atomic swap): OP_IF ... OP_SHA256 ... OP_CHECKLOCKTIMEVERIFY ... OP_ENDIF
  if (spk_asm && spk_asm.includes("OP_SHA256") && spk_asm.includes("OP_CHECKLOCKTIMEVERIFY")) {
    return "htlc";
  }

  // 7. Token output without token-operation predicate — treat as transfer.
  if (tokenId && !isNativeTokenId(tokenId)) {
    return "transfer";
  }

  // 8. Native NAV output — standard script types, nonstandard, BLSCT, or anything else
  return "transfer";
}

function extractPrevOutFromVin(vin: Record<string, unknown>): string {
  const directCandidates: unknown[] = [
    vin.outid,
    vin.outId,
    vin.out_id,
    vin.output_hash,
    vin.outpoint,
    vin.prev_out,
    vin.prevout,
    vin.hash,
  ];

  for (const candidate of directCandidates) {
    if (typeof candidate === "string" && candidate.length > 0) {
      return candidate;
    }
  }

  const outpointObj = vin.outpoint as Record<string, unknown> | undefined;
  const prevoutObj = vin.prevout as Record<string, unknown> | undefined;
  const nestedCandidates: unknown[] = [
    outpointObj?.output_hash,
    outpointObj?.hash,
    prevoutObj?.output_hash,
    prevoutObj?.hash,
    prevoutObj?.outpoint,
  ];
  for (const candidate of nestedCandidates) {
    if (typeof candidate === "string" && candidate.length > 0) {
      return candidate;
    }
  }

  return "";
}

export function computeBlockFees(
  rpcBlock: Record<string, unknown>,
  network: NetworkType,
  isBlsct: boolean
): BlockFees {
  const height = rpcBlock.height as number;
  const txs = (rpcBlock.tx as Record<string, unknown>[]) ?? [];
  const blockReward = getExpectedBlockReward(height, network, isBlsct);

  // Calculate coinbase total output value
  let coinbaseValue = 0;
  if (txs.length > 0) {
    const coinbaseTx = txs[0];
    const coinbaseVouts = (coinbaseTx.vout as Record<string, unknown>[]) ?? [];
    for (const vout of coinbaseVouts) {
      coinbaseValue += satoshis(vout.value);
    }
  }

  // fees_collected: for PoW blocks, coinbase value minus subsidy = miner fees
  // For BLSCT/PoS blocks, coinbase only gets the fixed reward, no fees
  let feesCollected = 0;
  if (!isBlsct && coinbaseValue > blockReward) {
    feesCollected = coinbaseValue - blockReward;
  }

  // fees_burned: sum of fee outputs (nulldata/fee type with value > 0) in non-coinbase txs
  let feesBurned = 0;
  for (let i = 1; i < txs.length; i++) {
    const tx = txs[i];
    // Check if the tx has a direct 'fee' field (some RPC responses include this)
    if (typeof tx.fee === 'number' && tx.fee > 0) {
      // Only count as burned if this is a BLSCT block where fees are burned
      if (isBlsct) {
        feesBurned += satoshis(tx.fee);
        continue;
      }
    }

    const vouts = (tx.vout as Record<string, unknown>[]) ?? [];
    for (const vout of vouts) {
      const spk = vout.scriptPubKey as Record<string, unknown> | undefined;
      if (!spk) continue;
      const spkType = spk.type as string | undefined;
      const val = satoshis(vout.value);
      if (val <= 0) continue;

      const predicate = extractDecodedPredicateFromVout(vout);
      if (predicate?.op === 3) {
        feesBurned += val;
        continue;
      }
      if (predicate?.op === 0 || predicate?.op === 1 || predicate?.op === 2 || predicate?.op === 4) {
        continue;
      }

      // Legacy fallback when predicate is unavailable: infer from OP_RETURN/fee script type.
      if (spkType === 'nulldata' || spkType === 'fee') {
        feesBurned += val;
      }
    }
  }

  return {
    block_reward: blockReward,
    fees_burned: feesBurned,
    fees_collected: feesCollected,
  };
}

export function parseBlock(rpcBlock: Record<string, unknown>, network: NetworkType = 'mainnet'): ParsedBlock {
  const txs = (rpcBlock.tx as Record<string, unknown>[]) ?? [];
  const blockVersion = rpcBlock.version as number;

  // Detect block type via version bits (from navio-core primitives/block.h)
  // VERSION_BIT_POS   = 0x01000000  →  block.IsProofOfStake()
  // VERSION_BIT_BLSCT = 0x40000000  →  block.IsBLSCT()
  const isPos = (blockVersion & 0x01000000) !== 0;
  const isBlsct = (blockVersion & 0x40000000) !== 0;

  const block: Block = {
    height: rpcBlock.height as number,
    hash: rpcBlock.hash as string,
    prev_hash: (rpcBlock.previousblockhash as string) ?? "",
    timestamp: rpcBlock.time as number,
    version: rpcBlock.version as number,
    merkle_root: rpcBlock.merkleroot as string,
    bits: rpcBlock.bits as string,
    nonce: rpcBlock.nonce as number,
    difficulty: rpcBlock.difficulty as number,
    size: rpcBlock.size as number,
    weight: rpcBlock.weight as number,
    tx_count: txs.length,
    is_pos: isPos,
    is_blsct: isBlsct,
    chainwork: (rpcBlock.chainwork as string) ?? "",
  };

  const transactions: Transaction[] = [];
  const outputs: Output[] = [];
  const inputs: Input[] = [];
  const tokenCollectionsById = new Map<string, TokenCollectionRecord>();
  const nftItemsById = new Map<string, NftItemRecord>();

  for (let txIndex = 0; txIndex < txs.length; txIndex++) {
    const rpcTx = txs[txIndex];
    const vins = (rpcTx.vin as Record<string, unknown>[]) ?? [];
    const vouts = (rpcTx.vout as Record<string, unknown>[]) ?? [];
    const txHex = typeof rpcTx.hex === "string" ? rpcTx.hex : "";
    const needsHexFallback = vouts.some((vout) => !extractPredicateHex(vout));
    const predicatesByVout = needsHexFallback && txHex
      ? parsePredicatesByVoutFromTxHex(txHex)
      : new Map<number, DecodedPredicate>();

    const isCoinbaseTx =
      vins.length > 0 && vins[0].coinbase !== undefined;

    let txIsBlsct = false;
    let txHasToken = false;

    // Parse outputs
    // Navio uses a single output hash as the outpoint identifier
    for (const rpcVout of vouts) {
      const voutIndex = rpcVout.n as number;
      // The output hash is the unique outpoint identifier in Navio
      const outputHash = (rpcVout.output_hash as string) ?? (rpcVout.outputhash as string) ?? (rpcVout.hash as string) ?? "";
      const blsct = isBlsctOutput(rpcVout);
      if (blsct) txIsBlsct = true;
      const rawTokenId = extractTokenId(rpcVout);
      const decodedPredicate =
        extractDecodedPredicateFromVout(rpcVout) ??
        predicatesByVout.get(voutIndex);
      const tokenId = deriveTokenIdFromPredicate(rawTokenId, decodedPredicate);
      const predicateHex = extractPredicateHex(rpcVout);
      const explicitPredicateLabel = extractPredicateLabel(rpcVout);
      const predicateLabel =
        predicateOpToLabel(decodedPredicate?.op) ??
        (explicitPredicateLabel && explicitPredicateLabel.length > 0
          ? explicitPredicateLabel
          : undefined);
      const predicateArgs = predicateArgsFromDecoded(decodedPredicate);

      const spkFields = extractSpkFields(rpcVout);
      const outputType = classifyOutputType(rpcVout, isCoinbaseTx, blsct, tokenId, decodedPredicate);
      const normalizedTokenId = sanitizeTokenIdForOutput(tokenId, decodedPredicate, outputType);
      const txid = rpcTx.txid as string;

      if (hasTokenFields(rpcVout) && normalizedTokenId && !isNativeTokenId(normalizedTokenId)) {
        txHasToken = true;
      }
      if (normalizedTokenId && !isNativeTokenId(normalizedTokenId)) txHasToken = true;
      if (decodedPredicate && (decodedPredicate.op === 0 || decodedPredicate.op === 1 || decodedPredicate.op === 2)) {
        txHasToken = true;
      }

      const tokenCollection = extractTokenCollectionRecord(
        outputType,
        normalizedTokenId,
        decodedPredicate,
        txid,
        outputHash,
        block.height,
        block.timestamp,
      );
      if (tokenCollection) {
        tokenCollectionsById.set(tokenCollection.token_id, tokenCollection);
      }

      const nftItem = extractNftItemRecord(
        outputType,
        normalizedTokenId,
        decodedPredicate,
        txid,
        outputHash,
        block.height,
        block.timestamp,
      );
      if (nftItem) {
        nftItemsById.set(nftItem.nft_id, nftItem);
      }

      if (blsct) {
        const fields = extractBlsctFields(rpcVout);
        outputs.push({
          txid,
          n: voutIndex,
          output_hash: outputHash,
          value_sat: satoshis(rpcVout.value),
          is_blsct: true,
          output_type: outputType,
          spk_type: spkFields.spk_type,
          spk_hex: spkFields.spk_hex,
          token_id: normalizedTokenId,
          predicate: predicateLabel,
          predicate_hex: predicateHex,
          predicate_args: predicateArgs,
          spending_key: fields.spending_key,
          ephemeral_key: fields.ephemeral_key,
          blinding_key: fields.blinding_key,
          view_tag: fields.view_tag,
        });
      } else {
        outputs.push({
          txid,
          n: voutIndex,
          output_hash: outputHash,
          value_sat: satoshis(rpcVout.value),
          address: extractAddress(rpcVout),
          is_blsct: false,
          output_type: outputType,
          spk_type: spkFields.spk_type,
          spk_hex: spkFields.spk_hex,
          token_id: normalizedTokenId,
          predicate: predicateLabel,
          predicate_hex: predicateHex,
          predicate_args: predicateArgs,
        });
      }
    }

    // Parse inputs
    // Navio references previous outputs by a single outpoint hash (not txid:vout)
    for (let vinIndex = 0; vinIndex < vins.length; vinIndex++) {
      const rpcVin = vins[vinIndex];
      const isCoinbaseInput = rpcVin.coinbase !== undefined;
      // prev_out is the output hash of the spent outpoint
      const prevOut = isCoinbaseInput ? "" : extractPrevOutFromVin(rpcVin);

      inputs.push({
        txid: rpcTx.txid as string,
        vin: vinIndex,
        prev_out: prevOut,
        is_coinbase: isCoinbaseInput,
      });
    }

    transactions.push({
      txid: rpcTx.txid as string,
      block_height: block.height,
      tx_index: txIndex,
      version: (rpcTx.version as number) ?? 0,
      size: (rpcTx.size as number) ?? 0,
      vsize: (rpcTx.vsize as number) ?? 0,
      locktime: (rpcTx.locktime as number) ?? 0,
      is_coinbase: isCoinbaseTx,
      is_blsct: txIsBlsct,
      input_count: vins.length,
      output_count: vouts.length,
      has_token: txHasToken,
      raw_json: toRawJson(rpcTx),
    });
  }

  const fees = computeBlockFees(rpcBlock, network, isBlsct);

  block.block_reward = fees.block_reward;
  block.fees_burned = fees.fees_burned;
  block.fees_collected = fees.fees_collected;

  return {
    block,
    transactions,
    outputs,
    inputs,
    token_collections: [...tokenCollectionsById.values()],
    nft_items: [...nftItemsById.values()],
    fees,
  };
}
