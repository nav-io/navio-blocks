import { useState } from 'react';
import { api } from '../api';
import { useApi } from '../hooks/useApi';
import { formatUSD, formatBTC, formatPercent } from '../utils';
import GlowCard from '../components/GlowCard';
import StatCard from '../components/StatCard';
import Loader from '../components/Loader';
import PriceChart from '../components/PriceChart';
import type { PriceData, PriceHistoryPoint, ChartPeriod } from '@navio-blocks/shared';

const PERIODS: { label: string; value: ChartPeriod }[] = [
  { label: '24h', value: '24h' },
  { label: '7d', value: '7d' },
  { label: '30d', value: '30d' },
  { label: '1y', value: '1y' },
];

export default function Price() {
  const [period, setPeriod] = useState<ChartPeriod>('7d');

  const { data: price, loading: priceLoading, error: priceError } = useApi<PriceData>(
    () => api.getPrice(),
    [],
  );

  const { data: history, loading: historyLoading } = useApi<PriceHistoryPoint[]>(
    () => api.getPriceHistory(period),
    [period],
  );

  const chartData = history
    ? history.map((p) => ({ timestamp: p.timestamp, value: p.price_usd }))
    : [];

  const changePositive = price ? price.change_24h_pct >= 0 : true;

  return (
    <div className="space-y-6">
      {/* Heading */}
      <h1 className="text-3xl font-bold gradient-text">NAV Price</h1>

      {/* Current price display */}
      {priceLoading ? (
        <Loader text="Loading price data..." />
      ) : priceError ? (
        <GlowCard hover={false}>
          <div className="text-center py-8">
            <p className="text-white/50 text-sm">Failed to load price data.</p>
            <p className="text-white/30 text-xs font-mono mt-1">{priceError}</p>
          </div>
        </GlowCard>
      ) : price ? (
        <GlowCard hover={false}>
          <div className="flex flex-col sm:flex-row sm:items-end gap-4">
            {/* USD price */}
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-white/40 mb-1">
                Current Price
              </p>
              <p className="text-4xl font-bold font-mono text-white">
                {formatUSD(price.price_usd)}
              </p>
            </div>

            {/* BTC price */}
            <div>
              <p className="font-mono text-sm text-white/50">
                {formatBTC(price.price_btc)}
              </p>
            </div>

            {/* 24h change */}
            <div className="sm:ml-auto">
              <p className="text-xs font-medium uppercase tracking-wider text-white/40 mb-1">
                24h Change
              </p>
              <p
                className={`text-2xl font-bold font-mono ${
                  changePositive ? 'text-green-400' : 'text-red-400'
                }`}
              >
                {formatPercent(price.change_24h_pct)}
              </p>
            </div>
          </div>
        </GlowCard>
      ) : null}

      {/* Period selector */}
      <div className="flex items-center gap-2">
        {PERIODS.map((p) => (
          <button
            key={p.value}
            onClick={() => setPeriod(p.value)}
            className={`px-4 py-1.5 rounded-full text-sm font-mono font-medium transition-all ${
              period === p.value
                ? 'bg-gradient-to-r from-neon-pink to-neon-purple text-white shadow-glow-pink'
                : 'bg-white/5 text-white/50 hover:bg-white/10 hover:text-white/70'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Chart */}
      <GlowCard hover={false} className="p-0 overflow-hidden">
        {historyLoading ? (
          <Loader text="Loading chart..." />
        ) : chartData.length > 0 ? (
          <PriceChart data={chartData} />
        ) : (
          <div className="flex items-center justify-center py-16">
            <p className="text-white/30 text-sm font-mono">No price history available.</p>
          </div>
        )}
      </GlowCard>

      {/* Stats below chart */}
      {price && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <StatCard
            label="Volume 24h"
            value={formatUSD(price.volume_24h)}
          />
          <StatCard
            label="Market Cap"
            value={formatUSD(price.market_cap)}
          />
        </div>
      )}
    </div>
  );
}
