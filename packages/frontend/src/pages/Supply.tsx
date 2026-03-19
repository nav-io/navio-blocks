import { useMemo, useState } from 'react';
import { api } from '../api';
import { useApi } from '../hooks/useApi';
import { formatNumber, satsToCoin, satsToCoinShort } from '../utils';
import GlowCard from '../components/GlowCard';
import StatCard from '../components/StatCard';
import PriceChart from '../components/PriceChart';
import Loader from '../components/Loader';

const PERIODS = ['24h', '7d', '30d', '1y', 'all'] as const;
type SupplyPeriod = (typeof PERIODS)[number];

const PERIOD_TO_SECONDS: Record<SupplyPeriod, number> = {
  '24h': 24 * 60 * 60,
  '7d': 7 * 24 * 60 * 60,
  '30d': 30 * 24 * 60 * 60,
  '1y': 365 * 24 * 60 * 60,
  all: 365 * 24 * 60 * 60,
};

interface SupplyProjection {
  points: { timestamp: number; value: number }[];
  emissionPerDaySat: number;
  burnPerDaySat: number;
  netPerDaySat: number;
}

function formatSignedNavPerDay(satPerDay: number): string {
  const sign = satPerDay > 0 ? '+' : satPerDay < 0 ? '-' : '';
  return `${sign}${satsToCoin(Math.abs(satPerDay))} NAV/day`;
}

function buildSupplyProjection(
  points: { timestamp: number; height: number; total_supply: number; total_burned: number }[],
  currentBlockRewardSat: number,
  avgBlockTimeSeconds: number | undefined,
  maxSupplySat: number,
  period: SupplyPeriod,
): SupplyProjection | null {
  if (!points || points.length < 2) return null;

  const sorted = [...points].sort((a, b) => a.timestamp - b.timestamp);
  const latest = sorted[sorted.length - 1];
  const lookbackStartTs = latest.timestamp - 30 * 24 * 60 * 60;
  const recent = sorted.filter((p) => p.timestamp >= lookbackStartTs);
  const baseline = recent.length >= 2 ? recent[0] : sorted[Math.max(0, sorted.length - 60)];
  const durationSec = latest.timestamp - baseline.timestamp;
  const heightDelta = latest.height - baseline.height;
  if (durationSec <= 0 || heightDelta <= 0) return null;

  const observedBlockTime = durationSec / heightDelta;
  const blockTime =
    avgBlockTimeSeconds && Number.isFinite(avgBlockTimeSeconds) && avgBlockTimeSeconds > 0
      ? avgBlockTimeSeconds
      : observedBlockTime;

  const blocksPerDay = 86_400 / Math.max(1, blockTime);
  const emissionPerDaySat = currentBlockRewardSat * blocksPerDay;
  const burnPerDaySat =
    ((latest.total_burned - baseline.total_burned) / durationSec) * 86_400;
  const netPerDaySat = emissionPerDaySat - burnPerDaySat;

  const horizonSec = PERIOD_TO_SECONDS[period] ?? PERIOD_TO_SECONDS.all;
  const steps = 48;
  const projectionPoints: { timestamp: number; value: number }[] = [];

  for (let i = 1; i <= steps; i++) {
    const elapsedSec = (horizonSec * i) / steps;
    const projectedSat = latest.total_supply + (netPerDaySat * elapsedSec) / 86_400;
    const clampedSat = Math.max(0, Math.min(maxSupplySat, projectedSat));
    projectionPoints.push({
      timestamp: latest.timestamp + Math.round(elapsedSec),
      value: clampedSat / 1e8,
    });
  }

  return {
    points: projectionPoints,
    emissionPerDaySat,
    burnPerDaySat,
    netPerDaySat,
  };
}

function PeriodSelector({
  selected,
  onChange,
}: {
  selected: string;
  onChange: (p: string) => void;
}) {
  return (
    <div className="flex gap-1 rounded-full border border-white/10 bg-white/[0.03] p-1">
      {PERIODS.map((p) => (
        <button
          key={p}
          onClick={() => onChange(p)}
          className={`px-3 py-1 text-xs font-medium rounded-full transition-all ${selected === p
              ? 'text-white bg-gradient-to-r from-neon-blue/30 via-neon-purple/25 to-neon-pink/25 shadow-[inset_0_1px_0_rgba(255,255,255,0.2)]'
              : 'text-white/50 hover:text-white hover:bg-white/5'
            }`}
        >
          {p.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

export default function Supply() {
  const [supplyPeriod, setSupplyPeriod] = useState('all');
  const [burnedPeriod, setBurnedPeriod] = useState('all');

  const { data: supply, loading: supplyLoading, error: supplyError } = useApi(
    () => api.getSupply(),
    [],
  );
  const { data: chartData, loading: chartLoading } = useApi(
    () => api.getSupplyChart(supplyPeriod),
    [supplyPeriod],
  );
  const { data: burnedChartData, loading: burnedChartLoading } = useApi(
    () => api.getSupplyChart(burnedPeriod),
    [burnedPeriod],
  );
  const { data: burnedData } = useApi(() => api.getSupplyBurned(), []);
  const { data: stats } = useApi(() => api.getStats(), []);

  const supplyChartSeries = useMemo(
    () =>
      (chartData ?? []).map((p) => ({
        timestamp: p.timestamp,
        value: p.total_supply / 1e8,
      })),
    [chartData],
  );

  const supplyProjection = useMemo(() => {
    if (!supply) return null;
    return buildSupplyProjection(
      chartData ?? [],
      supply.block_reward,
      stats?.avg_block_time,
      supply.max_supply,
      supplyPeriod as SupplyPeriod,
    );
  }, [chartData, supply, stats?.avg_block_time, supplyPeriod]);

  if (supplyLoading) return <Loader text="Loading supply data..." />;
  if (supplyError) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-red-400">Failed to load supply data: {supplyError}</p>
      </div>
    );
  }
  if (!supply) return null;

  return (
    <div className="min-h-screen">
      {/* Header */}


      {/* Top stat cards */}
      <section className="max-w-6xl mx-auto px-4 py-6">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <StatCard
            label="Total Supply"
            value={`${satsToCoinShort(supply.total_supply)} NAV`}
            subValue={`${satsToCoin(supply.total_supply)} `}
          />
          <StatCard
            label="Total Burned"
            value={`${satsToCoinShort(supply.total_burned)} NAV`}
          />
          <StatCard
            label="Block Reward"
            value={`${satsToCoin(supply.block_reward)} NAV`}
            subValue={`Height ${formatNumber(supply.height)}`}
          />
        </div>
      </section>

      {/* Supply Chart */}
      <section className="max-w-6xl mx-auto px-4 py-6">
        <GlowCard>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-white">Total Supply Over Time</h2>
            <PeriodSelector selected={supplyPeriod} onChange={setSupplyPeriod} />
          </div>
          {chartLoading ? (
            <Loader text="Loading chart..." />
          ) : chartData && chartData.length > 0 ? (
            <>
              <PriceChart
                data={supplyChartSeries}
                color="#4FB3FF"
                projectionData={supplyProjection?.points}
                projectionColor="rgba(88, 246, 187, 0.92)"
              />
              {supplyProjection && (
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs font-mono">
                  <span className="inline-block rounded px-2 py-0.5 border border-emerald-400/35 bg-emerald-400/10 text-emerald-200">
                    Simulated
                  </span>
                  <span className="text-white/45">
                    Emission: {formatSignedNavPerDay(supplyProjection.emissionPerDaySat)}
                  </span>
                  <span className="text-white/45">
                    Burn: {formatSignedNavPerDay(-supplyProjection.burnPerDaySat)}
                  </span>
                  <span className={supplyProjection.netPerDaySat >= 0 ? 'text-neon-blue' : 'text-neon-pink'}>
                    Net: {formatSignedNavPerDay(supplyProjection.netPerDaySat)}
                  </span>
                </div>
              )}
            </>
          ) : (
            <p className="text-gray-500 text-sm py-8 text-center">No chart data available.</p>
          )}
        </GlowCard>
      </section>

      {/* Burned Fees Chart */}
      <section className="max-w-6xl mx-auto px-4 py-6">
        <GlowCard>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-white">Cumulative Burned Fees</h2>
            <PeriodSelector selected={burnedPeriod} onChange={setBurnedPeriod} />
          </div>
          {burnedChartLoading ? (
            <Loader text="Loading chart..." />
          ) : burnedChartData && burnedChartData.length > 0 ? (
            <PriceChart
              data={burnedChartData.map((p) => ({
                timestamp: p.timestamp,
                value: p.total_burned / 1e8,
              }))}
              color="#E040A0"
            />
          ) : (
            <p className="text-gray-500 text-sm py-8 text-center">No burned data available.</p>
          )}
        </GlowCard>
      </section>

      {/* Burned Fees Summary */}
      {burnedData && (
        <section className="max-w-6xl mx-auto px-4 py-6 pb-16">
          <GlowCard>
            <h2 className="text-lg font-semibold text-white mb-4">Burned Fees Summary</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
              <div className="text-center">
                <p className="text-xs text-gray-400 mb-1">Total Burned</p>
                <p className="text-xl font-bold gradient-text">
                  {satsToCoinShort(burnedData.total_burned)} NAV
                </p>
              </div>
              <div className="text-center">
                <p className="text-xs text-gray-400 mb-1">Last 24h</p>
                <p className="text-xl font-bold text-neon-pink">
                  {satsToCoinShort(burnedData.burned_24h)} NAV
                </p>
              </div>
              <div className="text-center">
                <p className="text-xs text-gray-400 mb-1">Last 7d</p>
                <p className="text-xl font-bold text-neon-purple">
                  {satsToCoinShort(burnedData.burned_7d)} NAV
                </p>
              </div>
              <div className="text-center">
                <p className="text-xs text-gray-400 mb-1">Last 30d</p>
                <p className="text-xl font-bold text-neon-blue">
                  {satsToCoinShort(burnedData.burned_30d)} NAV
                </p>
              </div>
            </div>
          </GlowCard>
        </section>
      )}
    </div>
  );
}
