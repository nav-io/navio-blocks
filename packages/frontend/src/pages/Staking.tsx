import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useApi } from '../hooks/useApi';
import { formatNumber, timeAgo, truncateHash } from '../utils';
import GlowCard from '../components/GlowCard';
import StatCard from '../components/StatCard';
import Loader from '../components/Loader';
import PriceChart from '../components/PriceChart';
import OutputTypeBadge from '../components/OutputTypeBadge';
import { Pagination } from '../components/Pagination';
import type {
  StakingSummary,
  StakingHistoryPoint,
  StakingActivityPoint,
  StakingCommitment,
  ChartPeriod,
  PaginatedResponse,
} from '@navio-blocks/shared';

const PERIODS: { label: string; value: ChartPeriod }[] = [
  { label: '24h', value: '24h' },
  { label: '7d', value: '7d' },
  { label: '30d', value: '30d' },
  { label: '1y', value: '1y' },
];

type StatusFilter = 'active' | 'spent' | 'all';
type DelegationFilter = 'all' | 'delegated' | 'plain';
const PAGE_SIZE = 25;

function FilterButtons<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex gap-1.5">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
            value === o.value
              ? 'text-white bg-white/10 border-white/20'
              : 'text-white/50 border-white/10 hover:text-white hover:bg-white/5'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Stacked bars: stakes created (plain + delegated) above the axis, spent below. */
function ActivityBars({ points }: { points: StakingActivityPoint[] }) {
  if (points.length === 0) {
    return (
      <div className="flex items-center justify-center py-16">
        <p className="text-white/30 text-sm font-mono">No stake activity in this period.</p>
      </div>
    );
  }
  const max = Math.max(1, ...points.map((p) => Math.max(p.created, p.spent)));
  return (
    <div className="p-4">
      <div className="flex items-end gap-[2px] h-40">
        {points.map((p) => {
          const plain = p.created - p.delegated_created;
          const title = `${new Date(p.timestamp * 1000).toLocaleString()}\n${p.created} staked (${p.delegated_created} delegated), ${p.spent} unstaked`;
          return (
            <div key={p.timestamp} className="flex-1 min-w-[3px] flex flex-col justify-end h-full" title={title}>
              <div className="flex flex-col justify-end" style={{ height: '50%' }}>
                <div className="w-full bg-neon-purple/70" style={{ height: `${(p.delegated_created / max) * 100}%` }} />
                <div className="w-full bg-green-500/70" style={{ height: `${(plain / max) * 100}%` }} />
              </div>
              <div className="w-full border-t border-white/15" />
              <div className="flex flex-col justify-start" style={{ height: '50%' }}>
                <div className="w-full bg-red-500/60" style={{ height: `${(p.spent / max) * 100}%` }} />
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex items-center gap-4 mt-3 text-[11px] font-mono text-white/50">
        <span className="flex items-center gap-1.5"><i className="inline-block w-3 h-2 bg-green-500/70" /> staked</span>
        <span className="flex items-center gap-1.5"><i className="inline-block w-3 h-2 bg-neon-purple/70" /> delegated (cold)</span>
        <span className="flex items-center gap-1.5"><i className="inline-block w-3 h-2 bg-red-500/60" /> unstaked / re-staked</span>
      </div>
    </div>
  );
}

export default function Staking() {
  const [period, setPeriod] = useState<ChartPeriod>('30d');
  const [status, setStatus] = useState<StatusFilter>('active');
  const [delegation, setDelegation] = useState<DelegationFilter>('all');
  const [page, setPage] = useState(1);

  const { data: summary, loading, error } = useApi<StakingSummary>(
    () => api.getStakingSummary(),
    [],
  );
  const { data: history } = useApi<StakingHistoryPoint[]>(
    () => api.getStakingHistory(period),
    [period],
  );
  const { data: activity } = useApi<StakingActivityPoint[]>(
    () => api.getStakingActivity(period),
    [period],
  );
  const delegatedParam = delegation === 'delegated' ? '1' : delegation === 'plain' ? '0' : undefined;
  const { data: commitments, loading: commitmentsLoading } = useApi<PaginatedResponse<StakingCommitment>>(
    () => api.getStakingCommitments(status, delegatedParam, PAGE_SIZE, (page - 1) * PAGE_SIZE),
    [status, delegatedParam, page],
  );

  const activeChart = history
    ? history.map((p) => ({ timestamp: p.timestamp, value: p.active_commitments }))
    : [];
  const delegatedChart = history
    ? history.map((p) => ({ timestamp: p.timestamp, value: p.delegated_commitments }))
    : [];

  const totalPages = commitments ? Math.max(1, Math.ceil(commitments.total / PAGE_SIZE)) : 1;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold gradient-text">Staking</h1>
        <p className="text-white/50 text-sm mt-1">
          Staked commitments securing BLSCT proof of stake, including cold-staked
          commitments delegated to third-party operators. Amounts are hidden by
          BLSCT; only structure is public.
        </p>
      </div>

      {loading ? (
        <Loader text="Loading staking data..." />
      ) : error || !summary ? (
        <GlowCard hover={false}>
          <div className="text-center py-8">
            <p className="text-white/50 text-sm">Failed to load staking data.</p>
            {error && <p className="text-white/30 text-xs font-mono mt-1">{error}</p>}
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
            {summary.node && (
              <span className="ml-auto text-xs font-mono text-white/30">
                node snapshot {timeAgo(summary.node.timestamp)}
              </span>
            )}
          </div>

          {/* Section 1: staked set */}
          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-white">Staked Set</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard
                label="Active commitments"
                value={formatNumber(summary.active_commitments)}
                subValue={
                  summary.newest_active_timestamp
                    ? `newest ${timeAgo(summary.newest_active_timestamp)}`
                    : 'none yet'
                }
              />
              <StatCard
                label="Delegated (cold staking)"
                value={formatNumber(summary.delegated_commitments)}
                subValue={`${summary.delegated_pct.toFixed(2)}% of active`}
              />
              <StatCard
                label="Self-staked"
                value={formatNumber(summary.plain_commitments)}
                subValue="commitments without delegation"
              />
              <StatCard
                label="Node cross-check"
                value={
                  summary.node
                    ? summary.node.in_sync
                      ? 'in sync'
                      : 'drift'
                    : 'n/a'
                }
                subValue={
                  summary.node
                    ? `node sees ${formatNumber(summary.node.active_commitments)} (${formatNumber(summary.node.delegated_commitments)} delegated)`
                    : 'node RPC not sampled yet'
                }
              />
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <GlowCard hover={false} className="p-0 overflow-hidden">
                <p className="px-4 pt-3 text-[10px] uppercase tracking-wider text-white/40">Active commitments</p>
                {activeChart.length > 1 ? (
                  <PriceChart data={activeChart} color="#22c55e" />
                ) : (
                  <div className="flex items-center justify-center py-16">
                    <p className="text-white/30 text-sm font-mono">Collecting staked-set history…</p>
                  </div>
                )}
              </GlowCard>
              <GlowCard hover={false} className="p-0 overflow-hidden">
                <p className="px-4 pt-3 text-[10px] uppercase tracking-wider text-white/40">Delegated commitments</p>
                {delegatedChart.length > 1 ? (
                  <PriceChart data={delegatedChart} color="#A855F7" />
                ) : (
                  <div className="flex items-center justify-center py-16">
                    <p className="text-white/30 text-sm font-mono">Collecting delegation history…</p>
                  </div>
                )}
              </GlowCard>
            </div>
          </section>

          {/* Section 2: activity */}
          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-white">Stake Activity</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard label="Staked (24h)" value={formatNumber(summary.created_24h)} subValue="commitments created" />
              <StatCard label="Delegated (24h)" value={formatNumber(summary.delegated_created_24h)} subValue="cold-staking delegations created" />
              <StatCard label="Unstaked (24h)" value={formatNumber(summary.spent_24h)} subValue="commitments spent or re-staked" />
              <StatCard
                label="Lifetime"
                value={formatNumber(summary.total_created)}
                subValue={`${formatNumber(summary.total_delegated_created)} delegated · ${formatNumber(summary.total_spent)} spent`}
              />
            </div>
            <GlowCard hover={false} className="p-0 overflow-hidden">
              <ActivityBars points={activity ?? []} />
            </GlowCard>
          </section>

          {/* Section 3: commitments */}
          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-white">Commitments</h2>
            <GlowCard hover={false}>
              <div className="flex flex-wrap gap-6">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wider text-white/40 mb-2">Status</p>
                  <FilterButtons<StatusFilter>
                    value={status}
                    onChange={(v) => { setStatus(v); setPage(1); }}
                    options={[
                      { value: 'active', label: 'Active' },
                      { value: 'spent', label: 'Spent' },
                      { value: 'all', label: 'All' },
                    ]}
                  />
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wider text-white/40 mb-2">Delegation</p>
                  <FilterButtons<DelegationFilter>
                    value={delegation}
                    onChange={(v) => { setDelegation(v); setPage(1); }}
                    options={[
                      { value: 'all', label: 'All' },
                      { value: 'delegated', label: 'Delegated' },
                      { value: 'plain', label: 'Self-staked' },
                    ]}
                  />
                </div>
                {commitments && (
                  <div className="ml-auto self-end text-xs font-mono text-white/30">
                    {formatNumber(commitments.total)} commitments
                  </div>
                )}
              </div>
            </GlowCard>

            {commitmentsLoading && !commitments ? (
              <Loader text="Loading commitments..." />
            ) : commitments && commitments.data.length > 0 ? (
              <GlowCard hover={false}>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-white/10">
                        <th className="text-left text-[10px] uppercase tracking-wider text-white/40 pb-3 pr-4">Output</th>
                        <th className="text-left text-[10px] uppercase tracking-wider text-white/40 pb-3 pr-4">Type</th>
                        <th className="text-right text-[10px] uppercase tracking-wider text-white/40 pb-3 pr-4">Block</th>
                        <th className="text-right text-[10px] uppercase tracking-wider text-white/40 pb-3 pr-4">Staked</th>
                        <th className="text-left text-[10px] uppercase tracking-wider text-white/40 pb-3">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {commitments.data.map((c) => (
                        <tr key={c.output_hash} className="border-b border-white/5 last:border-b-0">
                          <td className="py-3 pr-4">
                            <Link
                              to={`/output/${c.output_hash}`}
                              className="font-mono text-sm text-neon-blue hover:text-neon-purple transition-colors"
                              title={c.output_hash}
                            >
                              {truncateHash(c.output_hash, 10)}
                            </Link>
                          </td>
                          <td className="py-3 pr-4">
                            <OutputTypeBadge type="stake" delegated={c.delegated} />
                          </td>
                          <td className="py-3 pr-4 text-right">
                            <Link to={`/block/${c.block_height}`} className="font-mono text-white/70 hover:text-neon-blue transition-colors">
                              {formatNumber(c.block_height)}
                            </Link>
                          </td>
                          <td className="py-3 pr-4 text-right font-mono text-white/50 whitespace-nowrap">
                            {timeAgo(c.timestamp)}
                          </td>
                          <td className="py-3">
                            {c.spent && c.spending_txid ? (
                              <Link
                                to={`/tx/${c.spending_txid}`}
                                className="inline-block rounded px-2 py-0.5 text-xs font-mono font-medium border border-red-500/30 bg-red-500/15 text-red-200 hover:bg-red-500/25 transition-colors"
                                title={c.spending_txid}
                              >
                                spent{c.spent_height != null ? ` @${formatNumber(c.spent_height)}` : ''}
                              </Link>
                            ) : (
                              <span className="inline-block rounded px-2 py-0.5 text-xs font-mono font-medium border border-green-500/30 bg-green-500/15 text-green-200">
                                staking
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="mt-4">
                  <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />
                </div>
              </GlowCard>
            ) : (
              <GlowCard hover={false}>
                <div className="text-center py-10">
                  <p className="text-white/40 text-sm">No commitments match these filters.</p>
                </div>
              </GlowCard>
            )}
          </section>

          {/* Explainer */}
          <GlowCard hover={false}>
            <h3 className="text-sm font-semibold uppercase tracking-wider text-white/60 mb-2">About cold staking</h3>
            <p className="text-white/50 text-sm leading-relaxed">
              A delegated commitment is a normal staked output whose opening (value and
              blinding factor) is encrypted to an operator's delegation key inside a
              DATA predicate. The operator can produce blocks with it but cannot spend or
              unstake the principal; the owner revokes at any time by unlocking. The
              explorer can tell a delegated commitment from a self-staked one, but the
              amount, the operator and the reward address stay private.
            </p>
          </GlowCard>
        </>
      )}
    </div>
  );
}
