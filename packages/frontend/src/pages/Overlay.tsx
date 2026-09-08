import { useState } from 'react';
import { api } from '../api';
import { useApi } from '../hooks/useApi';
import { formatNumber, formatBytes, timeAgo } from '../utils';
import GlowCard from '../components/GlowCard';
import StatCard from '../components/StatCard';
import Loader from '../components/Loader';
import PriceChart from '../components/PriceChart';
import type {
  P2pmsgSummary,
  P2pmsgHistoryPoint,
  P2pmsgTrading,
  ChartPeriod,
} from '@navio-blocks/shared';

const PERIODS: { label: string; value: ChartPeriod }[] = [
  { label: '24h', value: '24h' },
  { label: '7d', value: '7d' },
  { label: '30d', value: '30d' },
  { label: '1y', value: '1y' },
];

/** Colored delta vs a 24h-ago anchor (null anchor renders nothing). */
function Trend({
  current,
  previous,
  suffix = '',
}: {
  current: number;
  previous: number | null;
  suffix?: string;
}) {
  if (previous === null) {
    return <span className="text-white/30 text-xs font-mono">no 24h data</span>;
  }
  const delta = Math.round((current - previous) * 100) / 100;
  const positive = delta >= 0;
  return (
    <span
      className={`text-xs font-mono font-semibold ${
        delta === 0 ? 'text-white/40' : positive ? 'text-green-400' : 'text-red-400'
      }`}
    >
      {positive ? '+' : ''}
      {formatNumber(delta)}
      {suffix} <span className="text-white/30">24h</span>
    </span>
  );
}

export default function Overlay() {
  const [period, setPeriod] = useState<ChartPeriod>('7d');

  const { data: summary, loading: summaryLoading, error: summaryError } =
    useApi<P2pmsgSummary>(() => api.getP2pmsgSummary(), []);
  const { data: history } = useApi<P2pmsgHistoryPoint[]>(
    () => api.getP2pmsgHistory(period),
    [period],
  );
  const { data: trading } = useApi<P2pmsgTrading>(
    () => api.getP2pmsgTrading(),
    [],
  );

  const adoptionChart = history
    ? history.map((p) => ({ timestamp: p.timestamp, value: p.capable_pct }))
    : [];
  const anonymityChart = history
    ? history.map((p) => ({ timestamp: p.timestamp, value: p.agg_available }))
    : [];

  return (
    <div className="space-y-6">
      {/* Heading */}
      <div>
        <h1 className="text-3xl font-bold gradient-text">P2P Overlay</h1>
        <p className="text-white/50 text-sm mt-1">
          Adoption of the privacy-preserving p2pmsg overlay: relay reach, the
          private-send anonymity set, and decentralized OTC / RFQ liquidity.
        </p>
      </div>

      {summaryLoading ? (
        <Loader text="Loading overlay data..." />
      ) : summaryError ? (
        <GlowCard hover={false}>
          <div className="text-center py-8">
            <p className="text-white/50 text-sm">Failed to load overlay data.</p>
            <p className="text-white/30 text-xs font-mono mt-1">{summaryError}</p>
          </div>
        </GlowCard>
      ) : !summary || !summary.enabled ? (
        <GlowCard hover={false}>
          <div className="text-center py-16">
            <p className="text-white/60 text-lg font-semibold">
              P2P overlay not available on this node yet
            </p>
            <p className="text-white/40 text-sm mt-2 max-w-lg mx-auto">
              The connected Navio node does not expose the p2pmsg overlay
              (private-send aggregation and the decentralized OTC / RFQ swap bus).
              These stats will appear once a p2pmsg-capable node is indexed.
            </p>
          </div>
        </GlowCard>
      ) : (
        <>
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
            {summary.timestamp && (
              <span className="ml-auto text-xs font-mono text-white/30">
                updated {timeAgo(summary.timestamp)}
              </span>
            )}
          </div>

          {/* Section 1: Overlay adoption */}
          <section className="space-y-4">
            <div className="flex items-baseline justify-between">
              <h2 className="text-xl font-semibold text-white">Overlay Adoption</h2>
              <Trend
                current={summary.capable_pct}
                previous={summary.capable_pct_24h}
                suffix="pp"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <StatCard
                label="Relay-capable peers"
                value={formatNumber(summary.relay_capable_peers)}
                subValue={`of ${formatNumber(summary.total_peers)} connected`}
              />
              <StatCard
                label="Capable %"
                value={`${summary.capable_pct.toFixed(2)}%`}
                subValue="advertising NODE_P2PMSG"
              />
              <StatCard
                label="Pings received"
                value={formatNumber(summary.pings_received)}
              />
            </div>
            <GlowCard hover={false} className="p-0 overflow-hidden">
              {adoptionChart.length > 0 ? (
                <PriceChart data={adoptionChart} color="#4FB3FF" />
              ) : (
                <div className="flex items-center justify-center py-16">
                  <p className="text-white/30 text-sm font-mono">
                    No adoption history yet.
                  </p>
                </div>
              )}
            </GlowCard>
          </section>

          {/* Section 2: Private-send anonymity set */}
          <section className="space-y-4">
            <div className="flex items-baseline justify-between">
              <h2 className="text-xl font-semibold text-white">
                Private-send Anonymity Set
              </h2>
              <Trend
                current={summary.agg_available}
                previous={summary.agg_available_24h}
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <StatCard
                label="Cover candidates"
                value={formatNumber(summary.agg_available)}
                subValue="pool depth a private send can hide in"
              />
              <StatCard
                label="Extra fee / candidate"
                value={`${formatNumber(summary.agg_extra_fee_per_candidate)} sat`}
              />
            </div>
            <GlowCard hover={false} className="p-0 overflow-hidden">
              {anonymityChart.length > 0 ? (
                <PriceChart data={anonymityChart} color="#A855F7" />
              ) : (
                <div className="flex items-center justify-center py-16">
                  <p className="text-white/30 text-sm font-mono">
                    No anonymity-set history yet.
                  </p>
                </div>
              )}
            </GlowCard>
          </section>

          {/* Section 3: P2P trading */}
          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-white">P2P Trading</h2>
            <p className="text-white/40 text-sm">
              Decentralized OTC / RFQ liquidity from the p2pmsg swap bus.
              Individual orders are encrypted and never exposed &mdash; only
              aggregate counts are shown.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <StatCard
                label="Standing orders"
                value={formatNumber(trading?.orders_count ?? 0)}
              />
              <StatCard
                label="Order cache size"
                value={formatBytes(trading?.orders_bytes ?? 0)}
              />
              <StatCard
                label="Open RFQs"
                value={formatNumber(trading?.rfqs_count ?? 0)}
              />
            </div>
          </section>
        </>
      )}
    </div>
  );
}
