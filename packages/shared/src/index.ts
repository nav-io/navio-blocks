// Output type classification
export type OutputType =
  | 'transfer'
  | 'fee'
  | 'coinbase'
  | 'stake'
  | 'htlc'
  | 'token_create'
  | 'token_mint'
  | 'nft_create'
  | 'nft_mint'
  | 'unknown';

// Block types
export interface Block {
  height: number;
  hash: string;
  prev_hash: string;
  timestamp: number;
  version: number;
  merkle_root: string;
  bits: string;
  nonce: number;
  difficulty: number;
  size: number;
  weight: number;
  tx_count: number;
  is_pos: boolean;
  is_blsct: boolean;
  chainwork: string;
  block_reward?: number;      // satoshis
  fees_burned?: number;       // satoshis
  fees_collected?: number;    // satoshis
}

// Transaction types
export interface Transaction {
  txid: string;
  block_height: number;
  tx_index: number;
  version: number;
  size: number;
  vsize: number;
  locktime: number;
  is_coinbase: boolean;
  is_blsct: boolean;
  input_count: number;
  output_count: number;
  has_token: boolean;
  raw_json?: string | null;
}

// Output (transparent or BLSCT)
// Navio uses a single output hash as the outpoint identifier (not txid:vout)
export interface Output {
  txid: string;
  n: number;
  output_hash: string;
  spent?: boolean;
  spending_txid?: string | null;
  spending_vin?: number | null;
  // Transparent fields
  value_sat?: number;
  address?: string;
  // Classification
  output_type?: OutputType;
  spk_type?: string;
  spk_hex?: string;
  token_id?: string;
  predicate?: string;
  predicate_hex?: string;
  predicate_args?: Record<string, unknown>;
  /** Staked commitment delegated to a third-party operator (cold staking). */
  delegated?: boolean;
  // BLSCT fields
  spending_key?: string;
  ephemeral_key?: string;
  blinding_key?: string;
  view_tag?: string;
  is_blsct: boolean;
}

// Output enriched with block context for recent-activity listings
export interface LatestOutput extends Output {
  block_height: number;
  timestamp: number;
}

// Full output detail (output page)
export interface OutputDetail extends Output {
  block_height: number;
  timestamp: number;
  is_coinbase_tx: boolean;
}

// Output type distribution stats
/** New outputs created per time bucket (by block time). */
export interface OutputTimelinePoint {
  timestamp: number;
  /** All outputs created in the bucket. */
  total: number;
  coinbase: number;
  fee: number;
  /** total - coinbase - fee: outputs created by user transactions. */
  user: number;
}

export interface OutputTypeStats {
  type: OutputType;
  count: number;
  percentage: number;
}

// Staking overview (for network page)
export interface StakingInfo {
  active_stakes: number;
  total_staked_sat: number;
  total_ever_staked: number;
  avg_stake_age_seconds: number;
  oldest_stake_timestamp: number;
  newest_stake_timestamp: number;
  stake_value_distribution: { bucket: string; count: number }[];
  top_stakes: {
    output_hash: string;
    value_sat: number;
    block_height: number;
    timestamp: number;
    age_seconds: number;
  }[];
}

// Input
// Navio references previous outputs by a single hash (not txid:vout)
export interface Input {
  txid: string;
  vin: number;
  prev_out: string;
  is_coinbase: boolean;
  output_type?: OutputType;
}

// Transaction with full details
export interface TransactionDetail extends Transaction {
  inputs: Input[];
  outputs: Output[];
  naviod_tx?: Record<string, unknown> | null;
}

// Block with transactions
export interface BlockDetail extends Block {
  transactions: Transaction[];
}

// Network stats
export interface NetworkStats {
  network: NetworkType;
  height: number;
  difficulty: number;
  mempool_size: number;
  mempool_bytes: number;
  blsct_percentage: number;
  avg_block_time: number;
  total_outputs: number;
  hash_rate: number;
  connections: number;
}

// Mempool info
export interface MempoolInfo {
  size: number;
  bytes: number;
  usage: number;
  total_fee: number;
  max_mempool: number;
  mempool_min_fee: number;
}

// Peer / Node info
export interface Peer {
  id: number;
  addr: string;
  subversion: string;
  services: string;
  country?: string;
  city?: string;
  lat?: number;
  lon?: number;
  last_seen: number;
  first_seen: number;
  /**
   * Whether the peer accepts inbound TCP connections on its advertised port.
   * - true: confirmed listening / reachable.
   * - false: confirmed not listening (e.g. inbound-only / NAT'd peer).
   * - undefined: not probed (status unknown).
   */
  reachable?: boolean;
  /**
   * Unix seconds of the most recent successful P2P interaction with this peer
   * (RPC direct connection or completed `version`/`verack` handshake during a
   * crawl). Undefined when we've only ever heard about the peer via gossip.
   * Used to classify peers as "active" without trusting third‑party gossip
   * timestamps.
   */
  last_handshake?: number;
}

export interface NodeStats {
  total_nodes: number;
  /** Peers that accept inbound connections on their advertised port. */
  listening_nodes: number;
  /** Peers seen recently but that don't accept inbound connections. */
  non_listening_nodes: number;
  countries: { country: string; count: number }[];
  versions: { version: string; count: number }[];
  peers: Peer[];
}

export interface NodeMapData {
  peers: {
    lat: number;
    lon: number;
    country: string;
    city: string;
    subversion: string;
    reachable?: boolean;
  }[];
}

// Price data
export interface PriceData {
  price_usd: number;
  price_btc: number;
  change_24h_pct: number;
  volume_24h: number;
  market_cap: number;
  timestamp: number;
}

export interface PriceHistoryPoint {
  timestamp: number;
  price_usd: number;
  price_btc: number;
  volume_24h: number;
  market_cap: number;
}

// Chart data
export interface ChartPoint {
  timestamp: number;
  value: number;
}

export interface StatsChartData {
  block_times: ChartPoint[];
  tx_counts: ChartPoint[];
  difficulty: ChartPoint[];
}

// API response wrappers
export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  limit: number;
  offset: number;
}

/** Grouped matches when the query is a partial hex hash (see search API). */
export interface SearchMultiMatches {
  blocks: Block[];
  transactions: Transaction[];
  output_hashes: string[];
  token_ids: string[];
}

export interface SearchResult {
  type: 'block' | 'transaction' | 'output' | 'token' | 'nft' | 'multi' | 'none';
  block?: Block;
  transaction?: Transaction;
  output_hash?: string;
  token_id?: string;
  nft_index?: string;
  matches?: SearchMultiMatches;
}

export type ChartPeriod = '24h' | '7d' | '30d' | '1y';

// Network type
export type NetworkType = 'mainnet' | 'testnet';

/** Testnet PoS target block spacing (seconds), for emission estimates and UI. */
export const TESTNET_TARGET_BLOCK_SPACING_SEC = 120;

/**
 * Prefix of the Navio destination `note` in BSC `burnedWithNote` events (Bech32 HRP + `1`).
 * Mainnet uses `nav`, testnet uses `tnv` per navio-core `bech32_mod_hrp`.
 * Override with env `BSC_WNAV_NOTE_PREFIX` when indexer/API agree on the same value.
 */
export function wnavBridgeNotePrefix(
  network: NetworkType,
  notePrefixOverride?: string | null,
): string {
  const o = notePrefixOverride?.trim();
  if (o) return o.toLowerCase();
  return network === 'testnet' ? 'tnv1' : 'nav1';
}

// Supply info
export interface SupplyInfo {
  total_supply: number;       // current total supply in satoshis
  max_supply: number;         // 250M NAV in satoshis
  total_burned: number;       // total fees burned in satoshis
  block_reward: number;       // current block reward in satoshis
  height: number;
  network: NetworkType;
}

// Per-block supply data (stored in DB)
export interface BlockSupply {
  height: number;
  block_reward: number;       // satoshis
  fees_burned: number;        // satoshis
  fees_collected: number;     // satoshis
  total_supply: number;       // cumulative satoshis
}

// Supply chart point
export interface SupplyChartPoint {
  timestamp: number;
  height: number;
  total_supply: number;
  total_burned: number;
}

/** BSC wNAV burn via `burnedWithNote` with a Navio destination note (`nav1…` mainnet, `tnv1…` testnet by default). Amounts are raw token units (typically 18 decimals). */
export interface WrappedNavcoinBurn {
  timestamp: number;
  amount: string;
  tx_hash: string;
  note?: string | null;
  from_address?: string | null;
}

/** Snapshot of the bridge BLSCT audit wallet (navio-sdk + Electrum), stored when the indexer has `NAVIO_AUDIT_KEY` / `AUDIT_KEY` set. Amounts are NAV satoshis. */
export interface NavioBridgeAuditSummary {
  balance_sat: string;
  /** Cumulative staking rewards earned by the audited wallet (NAV sats). */
  earned_rewards_sat: string;
  synced_height: number;
  chain_tip: number;
  error_message: string | null;
  /** Unix seconds */
  updated_at: number;
  /** Sum of burns settled 1:1 by an on-chain payout (NAV sats). Provably distributed. */
  settled_sat?: string;
  /** Sum of burns not yet settled by any payout (NAV sats) — burned but awaiting payout. */
  awaiting_sat?: string;
  /** Sum of payout outflows that match no burn (NAV sats) — an inconsistency (over-pay / manual / internal). */
  unmatched_payout_sat?: string;
  /** Number of payout outflows that match no burn. */
  unmatched_payout_count?: number;
}

/** One outgoing native-NAV payout from the audited wallet (`spend_tx_hash` is the transaction that spent inputs). */
export interface NavioBridgeAuditOutgoing {
  spend_tx_hash: string;
  block_height: number;
  amount_sat: string;
  /** True when this payout was reconciled 1:1 to one or more wNAV burns. */
  matched?: boolean;
}

/** A wNAV burn with no matching Navio payout yet — a pending payout. */
export interface NavioBridgeAwaitingBurn {
  /** BSC burn tx hash (may be null for legacy rows). */
  tx_hash: string | null;
  /** Amount burned / owed on Navio (NAV sats). */
  amount_sat: string;
  /** Burn time (unix seconds). */
  timestamp: number;
  /** Destination Navio address from the burn note. */
  note: string | null;
}

/** A stake (commitment locked) or unstake (commitment unlocked) event on the audited wallet. */
export interface NavioBridgeAuditStakeEvent {
  tx_hash: string;
  event_type: 'stake' | 'unstake';
  block_height: number;
  amount_sat: string;
}

export type TokenKind = 'token' | 'nft' | 'unknown';

export interface TokenMetadataEntry {
  key: string;
  value: string;
}

export interface MintedNftEntry {
  index: string;
  metadata: TokenMetadataEntry[];
}

export interface TokenActivity extends LatestOutput {
  spent: boolean;
  spending_txid?: string | null;
  spending_vin?: number | null;
}

export interface TokenSummary {
  token_id: string;
  type: TokenKind;
  public_key?: string;
  metadata: TokenMetadataEntry[];
  max_supply: number | null;
  current_supply: number | null;
  mint_event_count: number;
  minted_nft_count: number;
  output_count: number;
  tx_count: number;
  first_seen_height: number | null;
  first_seen_timestamp: number | null;
  last_seen_height: number | null;
  last_seen_timestamp: number | null;
}

export interface TokenDetail extends TokenSummary {
  total_activity: number;
  activity: TokenActivity[];
  minted_nft: MintedNftEntry[];
}

export interface NftDetail {
  token_id: string;
  nft_index: string;
  nft_id: string;
  collection_type: TokenKind;
  collection_public_key?: string;
  collection_metadata: TokenMetadataEntry[];
  max_supply: number | null;
  nft_metadata: TokenMetadataEntry[];
  output_count: number;
  tx_count: number;
  first_seen_height: number | null;
  first_seen_timestamp: number | null;
  last_seen_height: number | null;
  last_seen_timestamp: number | null;
  current_owner_output_hash: string | null;
  current_owner_txid: string | null;
  current_owner_address: string | null;
  total_activity: number;
  activity: TokenActivity[];
}

// ---------------------------------------------------------------------------
// p2pmsg / P2P overlay stats
//
// The Navio node optionally exposes a peer-to-peer messaging overlay (p2pmsg)
// used for private-send candidate aggregation and a decentralized OTC/RFQ swap
// bus. These types describe the explorer's time-series view of that overlay.
// Every field degrades gracefully: a node without p2pmsg reports `enabled:
// false` and zeroed counters rather than an error.
// ---------------------------------------------------------------------------

/** One stored p2pmsg time-series snapshot (mirrors the p2pmsg_stats table). */
export interface P2pmsgStatsSnapshot {
  timestamp: number;
  network: NetworkType;
  enabled: boolean;
  /** Connected peers advertising NODE_P2PMSG (relay-capable). */
  relay_capable_peers: number;
  /** Total connected peers, from the node's own peer list. */
  total_peers: number;
  /** Fee-0 cover candidates in the aggregation pool (private-send anonymity set). */
  agg_available: number;
  /** Extra fee (sats) charged per additional aggregation candidate. */
  agg_extra_fee_per_candidate: number;
  /** Standing swap orders cached from the ORDER_ANN bus. */
  orders_count: number;
  /** Byte size of the cached order set. */
  orders_bytes: number;
  /** Open request-for-quote uuids. */
  rfqs_count: number;
  /** p2pmsg pings received by the node. */
  pings_received: number;
  identity_pubkey: string | null;
  inbox_pubkey: string | null;
}

/** Latest overlay snapshot plus derived adoption %, with 24h-ago comparisons for trends. */
export interface P2pmsgSummary {
  enabled: boolean;
  /** Unix seconds of the latest snapshot, or null when none recorded. */
  timestamp: number | null;
  relay_capable_peers: number;
  total_peers: number;
  /** relay_capable_peers / total_peers * 100 (0 when no peers). */
  capable_pct: number;
  agg_available: number;
  agg_extra_fee_per_candidate: number;
  pings_received: number;
  identity_pubkey: string | null;
  inbox_pubkey: string | null;
  /** Values from ~24h earlier for trend arrows (null when no prior sample). */
  relay_capable_peers_24h: number | null;
  capable_pct_24h: number | null;
  agg_available_24h: number | null;
}

/** One point in the overlay history series (for charts). */
export interface P2pmsgHistoryPoint {
  timestamp: number;
  relay_capable_peers: number;
  total_peers: number;
  capable_pct: number;
  agg_available: number;
  orders_count: number;
  rfqs_count: number;
}

/** Live decentralized OTC / RFQ liquidity snapshot (aggregate counts only). */
export interface P2pmsgTrading {
  enabled: boolean;
  timestamp: number | null;
  orders_count: number;
  orders_bytes: number;
  rfqs_count: number;
}

// ---------------------------------------------------------------------------
// Staking / cold-staking (delegated) commitments
// ---------------------------------------------------------------------------

/**
 * Staking overview. Counts come from the explorer's own chain index; the
 * `node` block is the connected node's `liststakedcommitmentsdata` view of the
 * unspent staked set (public data), used to cross-check the index.
 * Amounts are BLSCT-hidden and never available.
 */
export interface StakingSummary {
  /** Unspent staked commitments known to the index. */
  active_commitments: number;
  /** Of which carry a cold-staking delegation payload. */
  delegated_commitments: number;
  plain_commitments: number;
  /** delegated / active * 100 (0 when none). */
  delegated_pct: number;
  /** All staked commitments ever created (including spent / unstaked). */
  total_created: number;
  total_delegated_created: number;
  /** Staked commitments spent (unstake or re-stake) ever. */
  total_spent: number;
  /** Rolling 24h activity by block time. */
  created_24h: number;
  delegated_created_24h: number;
  spent_24h: number;
  /** Block time of the newest / oldest active commitment (null when none). */
  newest_active_timestamp: number | null;
  oldest_active_timestamp: number | null;
  /** Node-side snapshot of the unspent staked set, null if never sampled. */
  node: {
    timestamp: number;
    active_commitments: number;
    delegated_commitments: number;
    /** True when node and index agree on both counts at sample time. */
    in_sync: boolean;
  } | null;
}

/** One bucket of node-side staked-set snapshots (for charts). */
export interface StakingHistoryPoint {
  timestamp: number;
  active_commitments: number;
  delegated_commitments: number;
}

/** One time bucket of on-chain stake activity derived from block times. */
export interface StakingActivityPoint {
  timestamp: number;
  created: number;
  delegated_created: number;
  spent: number;
}

/** A staked commitment output as listed on the staking page. */
export interface StakingCommitment {
  output_hash: string;
  txid: string;
  n: number;
  block_height: number;
  timestamp: number;
  delegated: boolean;
  spent: boolean;
  spending_txid: string | null;
  spent_height: number | null;
}
