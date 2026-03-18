const API_BASE = '/api';

async function fetchJSON<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

// All API functions:
export const api = {
  // Blocks
  getBlocks: (limit = 20, offset = 0) =>
    fetchJSON<import('@navio-blocks/shared').PaginatedResponse<import('@navio-blocks/shared').Block>>(
      `/blocks?limit=${limit}&offset=${offset}`
    ),
  getBlock: (hashOrHeight: string) =>
    fetchJSON<import('@navio-blocks/shared').Block>(`/blocks/${hashOrHeight}`),
  getBlockTxs: (hashOrHeight: string, limit = 20, offset = 0) =>
    fetchJSON<import('@navio-blocks/shared').PaginatedResponse<import('@navio-blocks/shared').Transaction>>(
      `/blocks/${hashOrHeight}/txs?limit=${limit}&offset=${offset}`
    ),

  // Transactions
  getTx: (txid: string) =>
    fetchJSON<import('@navio-blocks/shared').TransactionDetail>(`/txs/${txid}`),
  getLatestOutputs: (limit = 20, offset = 0) =>
    fetchJSON<import('@navio-blocks/shared').PaginatedResponse<import('@navio-blocks/shared').LatestOutput>>(
      `/outputs?limit=${limit}&offset=${offset}`
    ),

  // Search
  search: (q: string) =>
    fetchJSON<import('@navio-blocks/shared').SearchResult>(`/search?q=${encodeURIComponent(q)}`),

  // Stats
  getStats: () =>
    fetchJSON<import('@navio-blocks/shared').NetworkStats>('/stats'),
  getStatsChart: (period: string) =>
    fetchJSON<import('@navio-blocks/shared').StatsChartData>(
      `/stats/chart?period=${period}`
    ),

  // Mempool
  getMempool: () =>
    fetchJSON<import('@navio-blocks/shared').MempoolInfo>('/mempool'),

  // Nodes
  getNodes: () =>
    fetchJSON<import('@navio-blocks/shared').NodeStats>('/nodes'),
  getNodeMap: () =>
    fetchJSON<import('@navio-blocks/shared').NodeMapData>('/nodes/map'),

  // Price
  getPrice: () =>
    fetchJSON<import('@navio-blocks/shared').PriceData>('/price'),
  getPriceHistory: (period: string) =>
    fetchJSON<import('@navio-blocks/shared').PriceHistoryPoint[]>(`/price/history?period=${period}`),

  // Supply
  getSupply: () =>
    fetchJSON<import('@navio-blocks/shared').SupplyInfo>('/supply'),
  getSupplyChart: (period = 'all') =>
    fetchJSON<import('@navio-blocks/shared').SupplyChartPoint[]>(`/supply/chart?period=${period}`),
  getSupplyBlock: (height: number) =>
    fetchJSON<import('@navio-blocks/shared').BlockSupply>(`/supply/block/${height}`),
  getSupplyBurned: () =>
    fetchJSON<{ total_burned: number; burned_24h: number; burned_7d: number; burned_30d: number }>('/supply/burned'),
};
