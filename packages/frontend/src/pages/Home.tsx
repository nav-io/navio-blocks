import { Link } from 'react-router-dom';
import { api } from '../api';
import { useApi } from '../hooks/useApi';
import { timeAgo, formatNumber, truncateHash, formatDifficulty, formatBytes, satsToCoin, satsToCoinShort } from '../utils';
import { SearchBar } from '../components/SearchBar';
import StatCard from '../components/StatCard';
import GlowCard from '../components/GlowCard';
import type { Block, LatestOutput } from '@navio-blocks/shared';

function BlockRowSkeleton() {
  return (
    <div className="flex items-center justify-between py-3 border-b border-white/5">
      <div className="flex items-center gap-3">
        <div className="skeleton w-16 h-5" />
        <div className="skeleton w-20 h-4" />
      </div>
      <div className="flex items-center gap-3">
        <div className="skeleton w-12 h-4" />
        <div className="skeleton w-16 h-4" />
      </div>
    </div>
  );
}

function TxRowSkeleton() {
  return (
    <div className="flex items-center justify-between py-3 border-b border-white/5">
      <div className="skeleton w-36 h-5" />
      <div className="flex items-center gap-3">
        <div className="skeleton w-14 h-4" />
        <div className="skeleton w-16 h-4" />
      </div>
    </div>
  );
}

export default function Home() {
  const { data: stats, loading: statsLoading } = useApi(() => api.getStats(), []);
  const { data: supply } = useApi(() => api.getSupply(), []);
  const { data: blocksRes, loading: blocksLoading } = useApi(
    () => api.getBlocks(10, 0),
    []
  );
  const { data: outputsRes, loading: outputsLoading } = useApi(
    () => api.getLatestOutputs(10, 0),
    []
  );

  return (
    <div className="grid-bg min-h-screen">
      {/* Hero */}
      <section className="text-center pt-16 pb-10 px-4">
        <h1 className="text-4xl sm:text-5xl md:text-6xl pb-6 font-bold gradient-text mb-4">
          Block Explorer
        </h1>
        <SearchBar className="max-w-2xl mx-auto" />
      </section>

      {/* Stats */}
      <section className="max-w-6xl mx-auto px-4 py-8">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {statsLoading ? (
            <>
              {[...Array(6)].map((_, i) => (
                <div key={i} className="glow-card text-center">
                  <div className="skeleton w-24 h-4 mx-auto mb-2" />
                  <div className="skeleton w-20 h-7 mx-auto" />
                </div>
              ))}
            </>
          ) : stats ? (
            <>
              <StatCard label="Block Height" value={formatNumber(stats.height)} />
              <StatCard label="Difficulty" value={formatDifficulty(stats.difficulty)} />
              <StatCard label="Mempool Size" value={formatNumber(stats.mempool_size)} subValue={`${formatBytes(stats.mempool_bytes)}`} />
              <StatCard label="Total Outputs" value={formatNumber(stats.total_outputs)} />
              {supply && (
                <StatCard
                  label="Total Supply"
                  value={`${satsToCoinShort(supply.total_supply)} NAV`}
                />
              )}
              {supply && supply.total_burned > 0 && (
                <StatCard
                  label="Total Burned"
                  value={`${satsToCoinShort(supply.total_burned)} NAV`}
                />
              )}
            </>
          ) : null}
        </div>
      </section>

      {/* Latest Blocks & Outputs */}
      <section className="max-w-6xl mx-auto px-4 pb-16">
        <div className="grid md:grid-cols-2 gap-6">
          {/* Latest Blocks */}
          <GlowCard>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-white">Latest Blocks</h2>
              <Link to="/blocks" className="text-sm text-neon-purple hover:text-neon-pink transition-colors">
                View all
              </Link>
            </div>
            <div className="space-y-0">
              {blocksLoading ? (
                [...Array(10)].map((_, i) => <BlockRowSkeleton key={i} />)
              ) : blocksRes?.data ? (
                blocksRes.data.map((block: Block) => (
                  <div
                    key={block.height}
                    className="flex items-center justify-between py-3 border-b border-white/5 last:border-b-0"
                  >
                    <div className="flex items-center gap-3">
                      <Link
                        to={`/block/${block.height}`}
                        className="font-mono text-sm text-neon-blue hover:text-neon-purple transition-colors"
                      >
                        #{formatNumber(block.height)}
                      </Link>
                      {block.is_pos && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-500/20 text-green-400 border border-green-500/30">
                          PoS
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-4 text-sm text-gray-400">
                      <span>{block.tx_count} txs</span>
                      <span className="text-xs">{timeAgo(block.timestamp)}</span>
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-gray-500 text-sm py-4">No blocks found.</p>
              )}
            </div>
          </GlowCard>

          {/* Latest Outputs */}
          <GlowCard>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-white">Latest Outputs</h2>
            </div>
            <div className="space-y-0">
              {outputsLoading ? (
                [...Array(10)].map((_, i) => <TxRowSkeleton key={i} />)
              ) : outputsRes?.data && outputsRes.data.length > 0 ? (
                outputsRes.data.map((output: LatestOutput) => (
                  <div
                    key={output.output_hash}
                    className="flex items-center justify-between py-3 border-b border-white/5 last:border-b-0"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <Link
                        to={`/tx/${output.output_hash}`}
                        className="font-mono text-sm text-neon-blue hover:text-neon-purple transition-colors truncate"
                      >
                        {truncateHash(output.output_hash, 12)}
                      </Link>
                      <span className="text-xs text-gray-400 whitespace-nowrap">
                        #{formatNumber(output.block_height)}
                      </span>
                    </div>
                    <div className="flex items-center gap-4 text-sm text-gray-400 ml-2 whitespace-nowrap">
                      <span>{timeAgo(output.timestamp)}</span>
                      <span className="font-mono text-white">
                        {output.value_sat != null && output.value_sat > 0
                          ? `${satsToCoin(output.value_sat)} NAV`
                          : ''}
                      </span>
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-gray-500 text-sm py-4">No outputs found.</p>
              )}
            </div>
          </GlowCard>
        </div>
      </section>
    </div>
  );
}
