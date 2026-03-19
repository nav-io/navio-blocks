import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useApi } from '../hooks/useApi';
import { truncateHash, formatNumber, timeAgo, satsToCoin, isRealToken, splitTokenId } from '../utils';
import { Pagination } from '../components/Pagination';
import GlowCard from '../components/GlowCard';
import OutputTypeBadge, { TYPE_BAR_COLORS } from '../components/OutputTypeBadge';
import Loader from '../components/Loader';
import type { OutputType, LatestOutput, OutputTypeStats, PaginatedResponse } from '@navio-blocks/shared';

const ALL_TYPES: OutputType[] = [
  'transfer', 'fee', 'coinbase', 'stake', 'htlc',
  'token_create', 'token_mint', 'nft_create', 'nft_mint', 'unknown',
];

const STAT_PERIODS = ['24h', '7d', '30d', '1y', 'all'] as const;
type StatPeriod = (typeof STAT_PERIODS)[number];

const PAGE_SIZE = 20;

type SpentFilter = 'all' | 'spent' | 'unspent';

export default function OutputList() {
  const [page, setPage] = useState(1);
  const [typeFilter, setTypeFilter] = useState<OutputType | null>(null);
  const [tokenMode, setTokenMode] = useState<'all' | 'nav' | 'tokens' | 'nfts'>('all');
  const [tokenIdInput, setTokenIdInput] = useState('');
  const [includeCoinbaseStats, setIncludeCoinbaseStats] = useState(false);
  const [statPeriod, setStatPeriod] = useState<StatPeriod>('30d');
  const [spentFilter, setSpentFilter] = useState<SpentFilter>('all');

  const showAll = typeFilter === 'coinbase' || typeFilter === 'fee' ? '1' : undefined;
  const spentParam = spentFilter === 'all' ? undefined : spentFilter === 'spent' ? '1' : '0';

  const { data: statsData } = useApi<OutputTypeStats[]>(
    () => api.getOutputTypeStats(includeCoinbaseStats, statPeriod),
    [includeCoinbaseStats, statPeriod],
  );

  const tokenModeParam = tokenMode === 'all' ? undefined : tokenMode;

  const { data: outputsRes, loading } = useApi<PaginatedResponse<LatestOutput>>(
    () => api.getOutputs(
      PAGE_SIZE,
      (page - 1) * PAGE_SIZE,
      typeFilter ?? undefined,
      tokenIdInput.trim() || undefined,
      tokenModeParam,
      showAll,
      spentParam,
    ),
    [page, typeFilter, tokenMode, tokenIdInput, spentFilter],
  );

  const totalPages = outputsRes ? Math.ceil(outputsRes.total / PAGE_SIZE) : 0;

  const handleTypeClick = (t: OutputType | null) => {
    setTypeFilter(t);
    setPage(1);
  };

  const handleTokenMode = (mode: 'all' | 'nav' | 'tokens' | 'nfts') => {
    setTokenMode(mode);
    if (mode !== 'tokens' && mode !== 'nfts') setTokenIdInput('');
    setPage(1);
  };

  const handleSpentFilter = (f: SpentFilter) => {
    setSpentFilter(f);
    setPage(1);
  };

  // Distribution chart
  const maxCount = statsData ? Math.max(...statsData.map((s) => s.count), 1) : 1;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-white">Outputs</h1>

      {/* Distribution chart */}
      {statsData && statsData.length > 0 && (
        <GlowCard hover={false}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-white/60">
              Output Type Distribution
            </h2>
            <div className="flex items-center gap-4">
              <div className="flex gap-1 rounded-full border border-white/10 bg-white/[0.03] p-1">
                {STAT_PERIODS.map((p) => (
                  <button
                    key={p}
                    onClick={() => setStatPeriod(p)}
                    className={`px-2.5 py-1 text-[10px] font-medium rounded-full transition-all ${
                      statPeriod === p
                        ? 'text-white bg-gradient-to-r from-neon-blue/30 via-neon-purple/25 to-neon-pink/25 shadow-[inset_0_1px_0_rgba(255,255,255,0.2)]'
                        : 'text-white/50 hover:text-white hover:bg-white/5'
                    }`}
                  >
                    {p === 'all' ? 'ALL' : p.toUpperCase()}
                  </button>
                ))}
              </div>
              <label className="flex items-center gap-2 text-xs text-white/60 select-none">
                <span>Coinbase</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={includeCoinbaseStats}
                  onClick={() => setIncludeCoinbaseStats((v) => !v)}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full border transition-colors ${
                    includeCoinbaseStats
                      ? 'bg-neon-pink/25 border-neon-pink/40'
                      : 'bg-white/10 border-white/20'
                  }`}
                >
                  <span
                    className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                      includeCoinbaseStats ? 'translate-x-4' : 'translate-x-0.5'
                    }`}
                  />
                </button>
              </label>
            </div>
          </div>
          <div className="space-y-2">
            {statsData.map((stat) => (
              <div key={stat.type} className="flex items-center gap-3">
                <div className="w-24 shrink-0">
                  <OutputTypeBadge type={stat.type} />
                </div>
                <div className="flex-1 h-5 bg-white/5 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${Math.max((stat.count / maxCount) * 100, 1)}%`,
                      backgroundColor: TYPE_BAR_COLORS[stat.type] ?? '#4b5563',
                    }}
                  />
                </div>
                <span className="text-xs font-mono text-white/60 w-20 text-right shrink-0">
                  {formatNumber(stat.count)}
                </span>
                <span className="text-xs font-mono text-white/40 w-14 text-right shrink-0">
                  {stat.percentage}%
                </span>
              </div>
            ))}
          </div>
        </GlowCard>
      )}

      {/* Filters */}
      <GlowCard hover={false}>
        <div className="space-y-4">
          {/* Type filter */}
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-white/40 mb-2">Type Filter</p>
            <div className="flex flex-wrap gap-1.5">
              <button
                onClick={() => handleTypeClick(null)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                  typeFilter === null
                    ? 'text-white bg-white/10 border-white/20'
                    : 'text-white/50 border-white/10 hover:text-white hover:bg-white/5'
                }`}
              >
                All
              </button>
              {ALL_TYPES.map((t) => (
                <button
                  key={t}
                  onClick={() => handleTypeClick(t)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                    typeFilter === t
                      ? 'text-white bg-white/10 border-white/20'
                      : 'text-white/50 border-white/10 hover:text-white hover:bg-white/5'
                  }`}
                >
                  {t.replace('_', ' ')}
                </button>
              ))}
            </div>
          </div>

          {/* Spent / Token / NFT filters */}
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-white/40 mb-2">Spent Status</p>
              <div className="flex gap-1.5">
                {(['all', 'unspent', 'spent'] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => handleSpentFilter(f)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                      spentFilter === f
                        ? 'text-white bg-white/10 border-white/20'
                        : 'text-white/50 border-white/10 hover:text-white hover:bg-white/5'
                    }`}
                  >
                    {f === 'all' ? 'All' : f === 'unspent' ? 'Unspent' : 'Spent'}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-white/40 mb-2">Token Filter</p>
              <div className="flex gap-1.5">
                {(['all', 'nav', 'tokens', 'nfts'] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => handleTokenMode(m)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                      tokenMode === m
                        ? 'text-white bg-white/10 border-white/20'
                        : 'text-white/50 border-white/10 hover:text-white hover:bg-white/5'
                    }`}
                  >
                    {m === 'all' ? 'All' : m === 'nav' ? 'NAV' : m === 'tokens' ? 'Tokens' : 'NFTs'}
                  </button>
                ))}
              </div>
            </div>
            {(tokenMode === 'tokens' || tokenMode === 'nfts') && (
              <div className="flex-1 min-w-[200px]">
                <p className="text-xs font-medium uppercase tracking-wider text-white/40 mb-2">Token ID</p>
                <input
                  type="text"
                  value={tokenIdInput}
                  onChange={(e) => { setTokenIdInput(e.target.value); setPage(1); }}
                  placeholder="Filter by token ID..."
                  className="w-full bg-navy-light/90 border border-white/15 rounded-lg text-white placeholder-white/35 focus:outline-none focus:border-neon-blue/60 focus:ring-1 focus:ring-neon-blue/30 transition-all px-3 py-1.5 text-xs font-mono"
                />
              </div>
            )}
          </div>
        </div>
      </GlowCard>

      {/* Outputs table */}
      {loading ? (
        <Loader text="Loading outputs..." />
      ) : outputsRes && outputsRes.data.length > 0 ? (
        <GlowCard hover={false}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="text-left text-[10px] uppercase tracking-wider text-white/40 pb-3 pr-4">Hash</th>
                  <th className="text-left text-[10px] uppercase tracking-wider text-white/40 pb-3 pr-4">Type</th>
                  <th className="text-left text-[10px] uppercase tracking-wider text-white/40 pb-3 pr-4">Token</th>
                  <th className="text-right text-[10px] uppercase tracking-wider text-white/40 pb-3 pr-4">Value</th>
                  <th className="text-right text-[10px] uppercase tracking-wider text-white/40 pb-3 pr-4">Block</th>
                  <th className="text-right text-[10px] uppercase tracking-wider text-white/40 pb-3">Time</th>
                </tr>
              </thead>
              <tbody>
                {outputsRes.data.map((o: LatestOutput) => (
                  <tr key={o.output_hash} className="border-b border-white/5 last:border-b-0">
                    <td className="py-3 pr-4">
                      <Link
                        to={`/output/${o.output_hash}`}
                        className="font-mono text-sm text-neon-blue hover:text-neon-purple transition-colors"
                        title={o.output_hash}
                      >
                        {truncateHash(o.output_hash, 10)}
                      </Link>
                    </td>
                    <td className="py-3 pr-4">
                      {o.output_type && <OutputTypeBadge type={o.output_type} />}
                    </td>
                    <td className="py-3 pr-4">
                      {isRealToken(o.token_id) ? (() => {
                        const tokenParts = splitTokenId(o.token_id);
                        const tokenBase = tokenParts?.base;
                        const nftIndex = tokenParts?.nftIndex;
                        const isNft = Boolean(nftIndex);
                        return (
                          <div className="space-y-1">
                            <span className={`inline-block rounded px-2 py-0.5 text-xs font-mono font-medium border ${
                              isNft
                                ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30'
                                : 'bg-teal-500/20 text-teal-300 border-teal-500/30'
                            }`}>
                              {isNft ? 'NFT' : 'Token'}
                            </span>
                            {tokenBase && (
                              isNft ? (
                                <Link
                                  to={`/nft/${tokenBase}/${nftIndex}`}
                                  className="block font-mono text-[11px] text-neon-blue hover:text-neon-purple transition-colors"
                                >
                                  {truncateHash(o.token_id!, 8)}
                                </Link>
                              ) : (
                                <Link
                                  to={`/token/${tokenBase}`}
                                  className="block font-mono text-[11px] text-neon-blue hover:text-neon-purple transition-colors"
                                >
                                  {truncateHash(tokenBase, 8)}
                                </Link>
                              )
                            )}
                          </div>
                        );
                      })() : o.token_id ? (
                        <span className="inline-block rounded px-2 py-0.5 text-xs font-mono font-medium border bg-blue-500/10 text-blue-300/60 border-blue-500/20">
                          NAV
                        </span>
                      ) : null}
                    </td>
                    <td className="py-3 pr-4 text-right font-mono text-white whitespace-nowrap">
                      {o.value_sat != null && o.value_sat > 0
                        ? `${satsToCoin(o.value_sat)} NAV`
                        : ''}
                    </td>
                    <td className="py-3 pr-4 text-right">
                      <Link
                        to={`/block/${o.block_height}`}
                        className="font-mono text-sm text-neon-blue hover:text-neon-purple transition-colors"
                      >
                        {formatNumber(o.block_height)}
                      </Link>
                    </td>
                    <td className="py-3 text-right text-xs text-gray-400 whitespace-nowrap">
                      {timeAgo(o.timestamp)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            currentPage={page}
            totalPages={totalPages}
            onPageChange={setPage}
          />
        </GlowCard>
      ) : (
        <GlowCard hover={false}>
          <p className="text-gray-500 text-sm py-4 text-center">No outputs found.</p>
        </GlowCard>
      )}
    </div>
  );
}
