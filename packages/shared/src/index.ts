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
}

export interface NodeStats {
  total_nodes: number;
  countries: { country: string; count: number }[];
  versions: { version: string; count: number }[];
  peers: Peer[];
}

export interface NodeMapData {
  peers: { lat: number; lon: number; country: string; city: string; subversion: string }[];
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

export interface SearchResult {
  type: 'block' | 'transaction' | 'output' | 'token' | 'nft' | 'none';
  block?: Block;
  transaction?: Transaction;
  output_hash?: string;
  token_id?: string;
  nft_index?: string;
}

export type ChartPeriod = '24h' | '7d' | '30d' | '1y';

// Network type
export type NetworkType = 'mainnet' | 'testnet';

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
