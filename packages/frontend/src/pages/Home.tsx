import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useApi } from '../hooks/useApi';
import { timeAgo, formatNumber, truncateHash, formatDifficulty, formatBytes, satsToCoin, satsToCoinShort } from '../utils';
import { SearchBar } from '../components/SearchBar';
import StatCard from '../components/StatCard';
import GlowCard from '../components/GlowCard';
import PriceChart from '../components/PriceChart';
import type { Block, LatestOutput, ChartPoint } from '@navio-blocks/shared';

const METRIC_PERIODS = ['24h', '7d', '30d', 'all'] as const;
const TREND_WINDOW = 10;
type MetricPeriod = (typeof METRIC_PERIODS)[number];

function formatSpacing(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '--';
  if (seconds >= 3600) return `${(seconds / 3600).toFixed(2)}h`;
  if (seconds >= 60) return `${(seconds / 60).toFixed(1)}m`;
  return `${seconds.toFixed(1)}s`;
}

function averageValue(points: ChartPoint[]): number {
  if (points.length === 0) return 0;
  return points.reduce((sum, point) => sum + point.value, 0) / points.length;
}

function formatChangePercent(value: number): string {
  if (!Number.isFinite(value)) return '--';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

function findDifficultyBaseline(points: ChartPoint[]): number | null {
  const values = points
    .map((point) => point.value)
    .filter((value) => Number.isFinite(value) && value > 0);
  if (values.length === 0) return null;

  const max = Math.max(...values);
  const minComparable = Math.max(max * 0.05, 1);
  const baselinePoint = points.find(
    (point) => Number.isFinite(point.value) && point.value >= minComparable,
  );
  return baselinePoint?.value ?? values[0];
}

function computeEma(points: ChartPoint[], period: number): ChartPoint[] {
  const sorted = points
    .filter((point) => Number.isFinite(point.timestamp) && Number.isFinite(point.value))
    .slice()
    .sort((a, b) => a.timestamp - b.timestamp);

  if (sorted.length === 0) return [];
  if (period <= 1) return sorted.map((point) => ({ ...point }));
  if (sorted.length < period) {
    // Not enough data to seed with full-window SMA: fallback to running mean.
    let runningSum = 0;
    return sorted.map((point, index) => {
      runningSum += point.value;
      return {
        timestamp: point.timestamp,
        value: runningSum / (index + 1),
      };
    });
  }

  const alpha = 2 / (period + 1);
  const seedWindow = sorted.slice(0, period);
  const seedSma = seedWindow.reduce((sum, point) => sum + point.value, 0) / period;
  const emaSeries: ChartPoint[] = [
    { timestamp: sorted[period - 1].timestamp, value: seedSma },
  ];

  let ema = seedSma;
  for (let i = period; i < sorted.length; i++) {
    ema = sorted[i].value * alpha + ema * (1 - alpha);
    emaSeries.push({
      timestamp: sorted[i].timestamp,
      value: ema,
    });
  }

  return emaSeries;
}

function computeRollingMedian(points: ChartPoint[], windowSize: number): ChartPoint[] {
  const sorted = points
    .filter((point) => Number.isFinite(point.timestamp) && Number.isFinite(point.value))
    .slice()
    .sort((a, b) => a.timestamp - b.timestamp);

  if (sorted.length === 0) return [];
  if (windowSize <= 1) return sorted.map((point) => ({ ...point }));

  const medianSeries: ChartPoint[] = [];
  for (let i = windowSize - 1; i < sorted.length; i++) {
    const window = sorted
      .slice(i - windowSize + 1, i + 1)
      .map((point) => point.value)
      .sort((a, b) => a - b);
    const mid = Math.floor(window.length / 2);
    const median = window.length % 2 === 0
      ? (window[mid - 1] + window[mid]) / 2
      : window[mid];
    medianSeries.push({
      timestamp: sorted[i].timestamp,
      value: median,
    });
  }

  return medianSeries;
}

function MetricPeriodSelector({
  selected,
  onChange,
}: {
  selected: MetricPeriod;
  onChange: (period: MetricPeriod) => void;
}) {
  return (
    <div className="flex gap-1 rounded-full border border-white/10 bg-white/[0.03] p-1">
      {METRIC_PERIODS.map((period) => (
        <button
          key={period}
          onClick={() => onChange(period)}
          className={`px-3 py-1 text-xs font-medium rounded-full transition-all ${selected === period
            ? 'text-white bg-gradient-to-r from-neon-blue/30 via-neon-purple/25 to-neon-pink/25 shadow-[inset_0_1px_0_rgba(255,255,255,0.2)]'
            : 'text-white/50 hover:text-white hover:bg-white/5'
            }`}
        >
          {period.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

function ChartSkeleton() {
  return <div className="h-[300px] w-full rounded-xl border border-white/5 bg-white/[0.02] animate-pulse" />;
}

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
  const [metricsPeriod, setMetricsPeriod] = useState<MetricPeriod>('7d');

  const { data: stats, loading: statsLoading } = useApi(() => api.getStats(), []);
  const { data: supply } = useApi(() => api.getSupply(), []);
  const { data: statsChart, loading: chartLoading } = useApi(
    () => api.getStatsChart(metricsPeriod),
    [metricsPeriod],
  );
  const { data: blocksRes, loading: blocksLoading } = useApi(
    () => api.getBlocks(10, 0),
    []
  );
  const { data: outputsRes, loading: outputsLoading } = useApi(
    () => api.getLatestOutputs(10, 0),
    []
  );

  const spacingSeries = statsChart?.block_times ?? [];
  const difficultySeries = statsChart?.difficulty ?? [];
  const spacingEmaSeries = useMemo(
    () => computeEma(spacingSeries, TREND_WINDOW),
    [spacingSeries],
  );
  const spacingMedianSeries = useMemo(
    () => computeRollingMedian(spacingSeries, TREND_WINDOW),
    [spacingSeries],
  );
  const difficultyEmaSeries = useMemo(
    () => computeEma(difficultySeries, TREND_WINDOW),
    [difficultySeries],
  );
  const difficultyMedianSeries = useMemo(
    () => computeRollingMedian(difficultySeries, TREND_WINDOW),
    [difficultySeries],
  );

  const latestSpacing = spacingSeries.length > 0
    ? spacingSeries[spacingSeries.length - 1].value
    : (stats?.avg_block_time ?? 0);
  const avgSpacing = spacingSeries.length > 0
    ? averageValue(spacingSeries)
    : (stats?.avg_block_time ?? 0);
  const latestDifficulty = difficultySeries.length > 0
    ? difficultySeries[difficultySeries.length - 1].value
    : (stats?.difficulty ?? 0);
  const difficultyBaseline = findDifficultyBaseline(difficultySeries);
  const difficultyChangePct = difficultyBaseline != null && difficultyBaseline > 0
    ? ((latestDifficulty - difficultyBaseline) / difficultyBaseline) * 100
    : null;

  return (
    <div className="min-h-screen">
      {/* Hero */}
      <section className="text-center pt-16 pb-10 px-4">
        <h1 className="text-4xl sm:text-5xl md:text-6xl pb-6 font-bold gradient-text mb-4">
          navio Block Explorer
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

      {/* Block Spacing & Difficulty */}
      <section className="max-w-6xl mx-auto px-4 pb-8">
        <GlowCard hover={false}>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold text-white">Block Spacing & Difficulty</h2>
              <p className="text-xs text-white/40 mt-1">Trend and summary for the selected period.</p>
            </div>
            <MetricPeriodSelector selected={metricsPeriod} onChange={setMetricsPeriod} />
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <StatCard label="Latest Spacing" value={formatSpacing(latestSpacing)} />
            <StatCard label="Average Spacing" value={formatSpacing(avgSpacing)} />
            <StatCard label="Latest Difficulty" value={formatDifficulty(latestDifficulty)} />
            <StatCard
              label="Difficulty Change"
              value={difficultyChangePct == null ? '--' : formatChangePercent(difficultyChangePct)}
              subValue={difficultyBaseline == null ? 'Insufficient data' : `${metricsPeriod.toUpperCase()} window`}
            />
          </div>

          <div className="grid md:grid-cols-2 gap-6">
            <div>
              <p className="text-sm font-semibold text-white mb-3">
                Block Spacing
              </p>
              {chartLoading ? (
                <ChartSkeleton />
              ) : spacingSeries.length > 0 ? (
                <PriceChart
                  data={spacingSeries}
                  color="#4FB3FF"
                  emaData={spacingEmaSeries}
                  emaColor="rgba(194, 226, 255, 0.85)"
                  medianData={spacingMedianSeries}
                  medianColor="rgba(166, 219, 255, 0.5)"
                />
              ) : (
                <div className="h-[300px] flex items-center justify-center rounded-xl border border-white/5 bg-white/[0.02]">
                  <p className="text-gray-500 text-sm">No spacing data available.</p>
                </div>
              )}
            </div>

            <div>
              <p className="text-sm font-semibold text-white mb-3">
                Block Difficulty
              </p>
              {chartLoading ? (
                <ChartSkeleton />
              ) : difficultySeries.length > 0 ? (
                <PriceChart
                  data={difficultySeries}
                  color="#E040A0"
                  emaData={difficultyEmaSeries}
                  emaColor="rgba(255, 206, 236, 0.85)"
                  medianData={difficultyMedianSeries}
                  medianColor="rgba(255, 198, 231, 0.5)"
                />
              ) : (
                <div className="h-[300px] flex items-center justify-center rounded-xl border border-white/5 bg-white/[0.02]">
                  <p className="text-gray-500 text-sm">No difficulty data available.</p>
                </div>
              )}
            </div>
          </div>
        </GlowCard>
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
              <Link to="/outputs" className="text-sm text-neon-purple hover:text-neon-pink transition-colors">
                View all
              </Link>
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
                        to={`/output/${output.output_hash}`}
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
