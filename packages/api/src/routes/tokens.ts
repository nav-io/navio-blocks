import { FastifyInstance } from "fastify";
import { queryAll, queryOne } from "../db.js";
import type {
  MintedNftEntry,
  NftDetail,
  PaginatedResponse,
  TokenActivity,
  TokenDetail,
  TokenKind,
  TokenMetadataEntry,
  TokenSummary,
} from "@navio-blocks/shared";

const NATIVE_TOKEN_ID =
  "0000000000000000000000000000000000000000000000000000000000000000";

const TOKEN_ID_RE = /^[0-9a-fA-F]{64}$/;
const NFT_INDEX_RE = /^\d+$/;

function tableExists(name: string): boolean {
  try {
    const row = queryOne<{ exists: number }>(
      `SELECT 1 AS exists
       FROM sqlite_master
       WHERE type = 'table' AND name = ?
       LIMIT 1`,
      name,
    );
    return row?.exists === 1;
  } catch {
    return false;
  }
}

const HAS_TOKEN_COLLECTIONS = tableExists("token_collections");
const HAS_NFT_ITEMS = tableExists("nft_items");

function baseTokenExpr(alias: string): string {
  return `LOWER(CASE
    WHEN instr(${alias}.token_id, '#') > 0
      THEN substr(${alias}.token_id, 1, instr(${alias}.token_id, '#') - 1)
    ELSE ${alias}.token_id
  END)`;
}

function candidateString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseMetadata(raw: unknown): TokenMetadataEntry[] {
  if (typeof raw !== "string" || raw.trim() === "") return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      const out: TokenMetadataEntry[] = [];
      for (const item of parsed) {
        if (!item || typeof item !== "object") continue;
        const obj = item as Record<string, unknown>;
        const key = candidateString(obj.key);
        const value = candidateString(obj.value);
        if (!key || !value) continue;
        out.push({ key, value });
      }
      return out;
    }
    if (parsed && typeof parsed === "object") {
      return Object.entries(parsed as Record<string, unknown>)
        .map(([key, value]) => {
          if (typeof value === "string") return { key, value };
          if (typeof value === "number" && Number.isFinite(value)) {
            return { key, value: String(value) };
          }
          if (typeof value === "boolean") return { key, value: value ? "true" : "false" };
          return null;
        })
        .filter((entry): entry is TokenMetadataEntry => Boolean(entry));
    }
    return [];
  } catch {
    return [];
  }
}

function normalizeOutputType(raw: unknown): string {
  const t = typeof raw === "string" ? raw : "unknown";
  if (t === "blsct" || t === "native" || t === "unstake" || t === "unknown") return "transfer";
  if (t === "data") return "fee";
  return t;
}

function parsePredicateArgs(raw: unknown): Record<string, unknown> | undefined {
  if (typeof raw !== "string" || raw.trim() === "") return undefined;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function toTokenActivity(row: Record<string, unknown>): TokenActivity {
  const spendingTxid = typeof row.spending_txid === "string" ? row.spending_txid : null;
  const spendingVinRaw = row.spending_vin;
  const spendingVin =
    typeof spendingVinRaw === "number"
      ? spendingVinRaw
      : spendingVinRaw == null
        ? null
        : Number(spendingVinRaw);

  return {
    output_hash: String(row.output_hash ?? ""),
    txid: String(row.txid ?? ""),
    n: Number(row.n ?? 0),
    value_sat:
      typeof row.value_sat === "number"
        ? row.value_sat
        : row.value_sat == null
          ? undefined
          : Number(row.value_sat),
    address: typeof row.address === "string" ? row.address : undefined,
    spending_key: typeof row.spending_key === "string" ? row.spending_key : undefined,
    ephemeral_key: typeof row.ephemeral_key === "string" ? row.ephemeral_key : undefined,
    blinding_key: typeof row.blinding_key === "string" ? row.blinding_key : undefined,
    view_tag: typeof row.view_tag === "string" ? row.view_tag : undefined,
    is_blsct: Boolean(row.is_blsct),
    output_type: normalizeOutputType(row.output_type) as TokenActivity["output_type"],
    spk_type: typeof row.spk_type === "string" ? row.spk_type : undefined,
    spk_hex: typeof row.spk_hex === "string" ? row.spk_hex : undefined,
    token_id: typeof row.token_id === "string" ? row.token_id : undefined,
    predicate: typeof row.predicate === "string" ? row.predicate : undefined,
    predicate_hex: typeof row.predicate_hex === "string" ? row.predicate_hex : undefined,
    predicate_args: parsePredicateArgs(row.predicate_args_json),
    block_height: Number(row.block_height ?? 0),
    timestamp: Number(row.timestamp ?? 0),
    spent: Boolean(spendingTxid),
    spending_txid: spendingTxid,
    spending_vin: Number.isFinite(spendingVin) ? spendingVin : null,
  };
}

function normalizeKind(raw: unknown): TokenKind {
  const value = candidateString(raw)?.toLowerCase();
  if (value === "token" || value === "nft") return value;
  return "unknown";
}

type TokenStatsRow = {
  token_id: string;
  has_nft_activity: number;
  output_count: number;
  tx_count: number;
  mint_event_count: number;
  minted_nft_count: number;
  first_seen_height: number | null;
  first_seen_timestamp: number | null;
  last_seen_height: number | null;
  last_seen_timestamp: number | null;
  token_type?: string | null;
  public_key?: string | null;
  max_supply?: number | null;
  metadata_json?: string | null;
};

function toTokenSummary(row: TokenStatsRow): TokenSummary {
  const fallbackType: TokenKind = row.has_nft_activity === 1 ? "nft" : "token";
  const type = normalizeKind(row.token_type) === "unknown" ? fallbackType : normalizeKind(row.token_type);

  return {
    token_id: row.token_id,
    type,
    public_key: candidateString(row.public_key ?? null) ?? undefined,
    metadata: parseMetadata(row.metadata_json ?? null),
    max_supply:
      typeof row.max_supply === "number"
        ? row.max_supply
        : row.max_supply == null
          ? null
          : Number(row.max_supply),
    current_supply: null,
    mint_event_count: Number(row.mint_event_count ?? 0),
    minted_nft_count: Number(row.minted_nft_count ?? 0),
    output_count: Number(row.output_count ?? 0),
    tx_count: Number(row.tx_count ?? 0),
    first_seen_height:
      row.first_seen_height == null ? null : Number(row.first_seen_height),
    first_seen_timestamp:
      row.first_seen_timestamp == null ? null : Number(row.first_seen_timestamp),
    last_seen_height:
      row.last_seen_height == null ? null : Number(row.last_seen_height),
    last_seen_timestamp:
      row.last_seen_timestamp == null ? null : Number(row.last_seen_timestamp),
  };
}

export default async function tokenRoutes(app: FastifyInstance) {
  app.get<{
    Querystring: { limit?: number; offset?: number; type?: "all" | "token" | "nft" };
  }>("/api/tokens", {
    schema: {
      tags: ["Tokens"],
      description: "List indexed token collections and NFT collections from on-chain data",
      querystring: {
        type: "object",
        properties: {
          limit: { type: "integer", minimum: 1, maximum: 100, default: 20 },
          offset: { type: "integer", minimum: 0, default: 0 },
          type: { type: "string", enum: ["all", "token", "nft"], default: "all" },
        },
      },
      response: {
        200: {
          type: "object",
          properties: {
            data: { type: "array", items: { type: "object", additionalProperties: true } },
            total: { type: "integer" },
            limit: { type: "integer" },
            offset: { type: "integer" },
          },
        },
      },
    },
  }, async (request): Promise<PaginatedResponse<TokenSummary>> => {
    const limit = Math.min(Math.max(Number(request.query.limit) || 20, 1), 100);
    const offset = Math.max(Number(request.query.offset) || 0, 0);
    const type = request.query.type ?? "all";

    const baseExpr = baseTokenExpr("o");
    const typeExpr = HAS_TOKEN_COLLECTIONS
      ? `COALESCE(tc.token_type, CASE WHEN ts.has_nft_activity = 1 THEN 'nft' ELSE 'token' END)`
      : `CASE WHEN ts.has_nft_activity = 1 THEN 'nft' ELSE 'token' END`;
    const mintedNftExpr = HAS_NFT_ITEMS
      ? `COALESCE((SELECT COUNT(*) FROM nft_items ni WHERE LOWER(ni.token_id) = ts.token_id), ts.minted_nft_count)`
      : `ts.minted_nft_count`;

    const rows = queryAll<TokenStatsRow>(
      `WITH token_stats AS (
         SELECT
           ${baseExpr} AS token_id,
           MAX(CASE WHEN o.token_id LIKE '%#%' OR o.output_type IN ('nft_create', 'nft_mint') THEN 1 ELSE 0 END) AS has_nft_activity,
           COUNT(*) AS output_count,
           COUNT(DISTINCT o.txid) AS tx_count,
           SUM(CASE WHEN o.output_type IN ('token_mint', 'nft_mint') THEN 1 ELSE 0 END) AS mint_event_count,
           COUNT(DISTINCT CASE WHEN o.token_id LIKE '%#%' THEN substr(o.token_id, instr(o.token_id, '#') + 1) END) AS minted_nft_count,
           MIN(t.block_height) AS first_seen_height,
           MIN(b.timestamp) AS first_seen_timestamp,
           MAX(t.block_height) AS last_seen_height,
           MAX(b.timestamp) AS last_seen_timestamp
         FROM outputs o
         JOIN transactions t ON t.txid = o.txid
         JOIN blocks b ON b.height = t.block_height
         WHERE o.token_id IS NOT NULL
           AND o.token_id <> ''
           AND ${baseExpr} <> LOWER(?)
         GROUP BY 1
       )
       SELECT
         ts.token_id,
         ts.has_nft_activity,
         ts.output_count,
         ts.tx_count,
         ts.mint_event_count,
         ${mintedNftExpr} AS minted_nft_count,
         ts.first_seen_height,
         ts.first_seen_timestamp,
         ts.last_seen_height,
         ts.last_seen_timestamp,
         ${HAS_TOKEN_COLLECTIONS ? "tc.token_type" : "NULL AS token_type"},
         ${HAS_TOKEN_COLLECTIONS ? "tc.public_key" : "NULL AS public_key"},
         ${HAS_TOKEN_COLLECTIONS ? "tc.max_supply" : "NULL AS max_supply"},
         ${HAS_TOKEN_COLLECTIONS ? "tc.metadata_json" : "NULL AS metadata_json"}
       FROM token_stats ts
       ${HAS_TOKEN_COLLECTIONS ? "LEFT JOIN token_collections tc ON LOWER(tc.token_id) = ts.token_id" : ""}
       WHERE (
         ? = 'all'
         OR (? = 'token' AND ${typeExpr} = 'token')
         OR (? = 'nft' AND ${typeExpr} = 'nft')
       )
       ORDER BY ts.last_seen_height DESC, ts.token_id ASC
       LIMIT ? OFFSET ?`,
      NATIVE_TOKEN_ID,
      type,
      type,
      type,
      limit,
      offset,
    );

    const total = queryOne<{ count: number }>(
      `WITH token_stats AS (
         SELECT
           ${baseExpr} AS token_id,
           MAX(CASE WHEN o.token_id LIKE '%#%' OR o.output_type IN ('nft_create', 'nft_mint') THEN 1 ELSE 0 END) AS has_nft_activity
         FROM outputs o
         WHERE o.token_id IS NOT NULL
           AND o.token_id <> ''
           AND ${baseExpr} <> LOWER(?)
         GROUP BY 1
       )
       SELECT COUNT(*) AS count
       FROM token_stats ts
       ${HAS_TOKEN_COLLECTIONS ? "LEFT JOIN token_collections tc ON LOWER(tc.token_id) = ts.token_id" : ""}
       WHERE (
         ? = 'all'
         OR (? = 'token' AND ${typeExpr} = 'token')
         OR (? = 'nft' AND ${typeExpr} = 'nft')
       )`,
      NATIVE_TOKEN_ID,
      type,
      type,
      type,
    )?.count ?? 0;

    return {
      data: rows.map(toTokenSummary),
      total,
      limit,
      offset,
    };
  });

  app.get<{
    Params: { tokenId: string };
    Querystring: { limit?: number; offset?: number };
  }>("/api/tokens/:tokenId", {
    schema: {
      tags: ["Tokens"],
      description: "Get token collection or NFT collection details by base token ID",
      params: {
        type: "object",
        required: ["tokenId"],
        properties: {
          tokenId: { type: "string" },
        },
      },
      querystring: {
        type: "object",
        properties: {
          limit: { type: "integer", minimum: 1, maximum: 100, default: 20 },
          offset: { type: "integer", minimum: 0, default: 0 },
        },
      },
      response: {
        200: { type: "object", additionalProperties: true },
        404: {
          type: "object",
          properties: { error: { type: "string" } },
        },
      },
    },
  }, async (request, reply) => {
    const tokenId = request.params.tokenId.trim().toLowerCase();
    if (!TOKEN_ID_RE.test(tokenId)) {
      return reply.status(404).send({ error: "Token not found" });
    }

    const limit = Math.min(Math.max(Number(request.query.limit) || 20, 1), 100);
    const offset = Math.max(Number(request.query.offset) || 0, 0);

    const collectionRow = HAS_TOKEN_COLLECTIONS
      ? queryOne<{
          token_type: string | null;
          public_key: string | null;
          max_supply: number | null;
          metadata_json: string | null;
        }>(
          `SELECT token_type, public_key, max_supply, metadata_json
           FROM token_collections
           WHERE LOWER(token_id) = LOWER(?)`,
          tokenId,
        )
      : undefined;

    const stats = queryOne<{
      has_nft_activity: number;
      output_count: number;
      tx_count: number;
      mint_event_count: number;
      minted_nft_count: number;
      first_seen_height: number | null;
      first_seen_timestamp: number | null;
      last_seen_height: number | null;
      last_seen_timestamp: number | null;
    }>(
      `SELECT
         MAX(CASE WHEN o.token_id LIKE '%#%' OR o.output_type IN ('nft_create', 'nft_mint') THEN 1 ELSE 0 END) AS has_nft_activity,
         COUNT(*) AS output_count,
         COUNT(DISTINCT o.txid) AS tx_count,
         SUM(CASE WHEN o.output_type IN ('token_mint', 'nft_mint') THEN 1 ELSE 0 END) AS mint_event_count,
         COUNT(DISTINCT CASE WHEN o.token_id LIKE '%#%' THEN substr(o.token_id, instr(o.token_id, '#') + 1) END) AS minted_nft_count,
         MIN(t.block_height) AS first_seen_height,
         MIN(b.timestamp) AS first_seen_timestamp,
         MAX(t.block_height) AS last_seen_height,
         MAX(b.timestamp) AS last_seen_timestamp
       FROM outputs o
       JOIN transactions t ON t.txid = o.txid
       JOIN blocks b ON b.height = t.block_height
       WHERE ${baseTokenExpr("o")} = LOWER(?)
         AND o.token_id IS NOT NULL
         AND o.token_id <> ''`,
      tokenId,
    );

    const mintedNfts = HAS_NFT_ITEMS
      ? queryAll<{ nft_index: string; metadata_json: string | null }>(
          `SELECT nft_index, metadata_json
           FROM nft_items
           WHERE LOWER(token_id) = LOWER(?)
           ORDER BY CAST(nft_index AS INTEGER), nft_index`,
          tokenId,
        ).map<MintedNftEntry>((row) => ({
          index: row.nft_index,
          metadata: parseMetadata(row.metadata_json),
        }))
      : [];

    const activityRows = queryAll<Record<string, unknown>>(
      `SELECT
         o.output_hash, o.txid, o.n, o.value_sat, o.address,
         o.spending_key, o.ephemeral_key, o.blinding_key, o.view_tag,
         o.is_blsct, o.output_type, o.spk_type, o.spk_hex, o.token_id,
         o.predicate, o.predicate_hex, o.predicate_args_json,
         t.block_height, b.timestamp,
         i.txid AS spending_txid, i.vin AS spending_vin
       FROM outputs o
       JOIN transactions t ON t.txid = o.txid
       JOIN blocks b ON b.height = t.block_height
       LEFT JOIN inputs i ON i.prev_out = o.output_hash AND i.prev_out <> ''
       WHERE ${baseTokenExpr("o")} = LOWER(?)
       ORDER BY t.block_height DESC, t.tx_index DESC, o.n ASC
       LIMIT ? OFFSET ?`,
      tokenId,
      limit,
      offset,
    );

    const totalActivity = queryOne<{ count: number }>(
      `SELECT COUNT(*) AS count
       FROM outputs o
       WHERE ${baseTokenExpr("o")} = LOWER(?)`,
      tokenId,
    )?.count ?? 0;

    const hasStats = (stats?.output_count ?? 0) > 0;
    if (!hasStats && !collectionRow) {
      return reply.status(404).send({ error: "Token not found" });
    }

    const inferredType: TokenKind = (stats?.has_nft_activity ?? 0) === 1 ? "nft" : "token";
    const collectionType = normalizeKind(collectionRow?.token_type) === "unknown"
      ? inferredType
      : normalizeKind(collectionRow?.token_type);

    const detail: TokenDetail = {
      token_id: tokenId,
      type: collectionType,
      public_key: candidateString(collectionRow?.public_key ?? null) ?? undefined,
      metadata: parseMetadata(collectionRow?.metadata_json ?? null),
      max_supply:
        typeof collectionRow?.max_supply === "number"
          ? collectionRow.max_supply
          : collectionRow?.max_supply == null
            ? null
            : Number(collectionRow.max_supply),
      current_supply: null,
      mint_event_count: Number(stats?.mint_event_count ?? 0),
      minted_nft_count: mintedNfts.length > 0
        ? mintedNfts.length
        : Number(stats?.minted_nft_count ?? 0),
      output_count: Number(stats?.output_count ?? 0),
      tx_count: Number(stats?.tx_count ?? 0),
      first_seen_height:
        stats?.first_seen_height == null ? null : Number(stats.first_seen_height),
      first_seen_timestamp:
        stats?.first_seen_timestamp == null ? null : Number(stats.first_seen_timestamp),
      last_seen_height:
        stats?.last_seen_height == null ? null : Number(stats.last_seen_height),
      last_seen_timestamp:
        stats?.last_seen_timestamp == null ? null : Number(stats.last_seen_timestamp),
      total_activity: totalActivity,
      activity: activityRows.map(toTokenActivity),
      minted_nft: mintedNfts,
    };

    return detail;
  });

  app.get<{
    Params: { tokenId: string; index: string };
    Querystring: { limit?: number; offset?: number };
  }>("/api/nfts/:tokenId/:index", {
    schema: {
      tags: ["Tokens"],
      description: "Get a specific NFT detail by token ID and NFT index",
      params: {
        type: "object",
        required: ["tokenId", "index"],
        properties: {
          tokenId: { type: "string" },
          index: { type: "string" },
        },
      },
      querystring: {
        type: "object",
        properties: {
          limit: { type: "integer", minimum: 1, maximum: 100, default: 20 },
          offset: { type: "integer", minimum: 0, default: 0 },
        },
      },
      response: {
        200: { type: "object", additionalProperties: true },
        404: {
          type: "object",
          properties: { error: { type: "string" } },
        },
      },
    },
  }, async (request, reply) => {
    const tokenId = request.params.tokenId.trim().toLowerCase();
    const nftIndex = request.params.index.trim();

    if (!TOKEN_ID_RE.test(tokenId) || !NFT_INDEX_RE.test(nftIndex)) {
      return reply.status(404).send({ error: "NFT not found" });
    }

    const nftId = `${tokenId}#${nftIndex}`;
    const limit = Math.min(Math.max(Number(request.query.limit) || 20, 1), 100);
    const offset = Math.max(Number(request.query.offset) || 0, 0);

    const collectionRow = HAS_TOKEN_COLLECTIONS
      ? queryOne<{
          token_type: string | null;
          public_key: string | null;
          max_supply: number | null;
          metadata_json: string | null;
        }>(
          `SELECT token_type, public_key, max_supply, metadata_json
           FROM token_collections
           WHERE LOWER(token_id) = LOWER(?)`,
          tokenId,
        )
      : undefined;

    const nftRow = HAS_NFT_ITEMS
      ? queryOne<{ metadata_json: string | null }>(
          `SELECT metadata_json
           FROM nft_items
           WHERE LOWER(token_id) = LOWER(?) AND nft_index = ?`,
          tokenId,
          nftIndex,
        )
      : undefined;

    const stats = queryOne<{
      output_count: number;
      tx_count: number;
      first_seen_height: number | null;
      first_seen_timestamp: number | null;
      last_seen_height: number | null;
      last_seen_timestamp: number | null;
    }>(
      `SELECT
         COUNT(*) AS output_count,
         COUNT(DISTINCT o.txid) AS tx_count,
         MIN(t.block_height) AS first_seen_height,
         MIN(b.timestamp) AS first_seen_timestamp,
         MAX(t.block_height) AS last_seen_height,
         MAX(b.timestamp) AS last_seen_timestamp
       FROM outputs o
       JOIN transactions t ON t.txid = o.txid
       JOIN blocks b ON b.height = t.block_height
       WHERE LOWER(o.token_id) = LOWER(?)`,
      nftId,
    );

    const hasStats = (stats?.output_count ?? 0) > 0;
    if (!hasStats && !nftRow) {
      return reply.status(404).send({ error: "NFT not found" });
    }

    const ownerRow = queryOne<{
      output_hash: string;
      txid: string;
      address: string | null;
    }>(
      `SELECT o.output_hash, o.txid, o.address
       FROM outputs o
       JOIN transactions t ON t.txid = o.txid
       WHERE LOWER(o.token_id) = LOWER(?)
         AND NOT EXISTS (
           SELECT 1 FROM inputs i
           WHERE i.prev_out = o.output_hash
             AND i.prev_out <> ''
         )
       ORDER BY t.block_height DESC, t.tx_index DESC, o.n DESC
       LIMIT 1`,
      nftId,
    );

    const activityRows = queryAll<Record<string, unknown>>(
      `SELECT
         o.output_hash, o.txid, o.n, o.value_sat, o.address,
         o.spending_key, o.ephemeral_key, o.blinding_key, o.view_tag,
         o.is_blsct, o.output_type, o.spk_type, o.spk_hex, o.token_id,
         o.predicate, o.predicate_hex, o.predicate_args_json,
         t.block_height, b.timestamp,
         i.txid AS spending_txid, i.vin AS spending_vin
       FROM outputs o
       JOIN transactions t ON t.txid = o.txid
       JOIN blocks b ON b.height = t.block_height
       LEFT JOIN inputs i ON i.prev_out = o.output_hash AND i.prev_out <> ''
       WHERE LOWER(o.token_id) = LOWER(?)
       ORDER BY t.block_height DESC, t.tx_index DESC, o.n ASC
       LIMIT ? OFFSET ?`,
      nftId,
      limit,
      offset,
    );

    const totalActivity = queryOne<{ count: number }>(
      `SELECT COUNT(*) AS count
       FROM outputs
       WHERE LOWER(token_id) = LOWER(?)`,
      nftId,
    )?.count ?? 0;

    const detail: NftDetail = {
      token_id: tokenId,
      nft_index: nftIndex,
      nft_id: nftId,
      collection_type: normalizeKind(collectionRow?.token_type) === "unknown"
        ? "nft"
        : normalizeKind(collectionRow?.token_type),
      collection_public_key: candidateString(collectionRow?.public_key ?? null) ?? undefined,
      collection_metadata: parseMetadata(collectionRow?.metadata_json ?? null),
      max_supply:
        typeof collectionRow?.max_supply === "number"
          ? collectionRow.max_supply
          : collectionRow?.max_supply == null
            ? null
            : Number(collectionRow.max_supply),
      nft_metadata: parseMetadata(nftRow?.metadata_json ?? null),
      output_count: Number(stats?.output_count ?? 0),
      tx_count: Number(stats?.tx_count ?? 0),
      first_seen_height:
        stats?.first_seen_height == null ? null : Number(stats.first_seen_height),
      first_seen_timestamp:
        stats?.first_seen_timestamp == null ? null : Number(stats.first_seen_timestamp),
      last_seen_height:
        stats?.last_seen_height == null ? null : Number(stats.last_seen_height),
      last_seen_timestamp:
        stats?.last_seen_timestamp == null ? null : Number(stats.last_seen_timestamp),
      current_owner_output_hash: ownerRow?.output_hash ?? null,
      current_owner_txid: ownerRow?.txid ?? null,
      current_owner_address: ownerRow?.address ?? null,
      total_activity: totalActivity,
      activity: activityRows.map(toTokenActivity),
    };

    return detail;
  });
}
