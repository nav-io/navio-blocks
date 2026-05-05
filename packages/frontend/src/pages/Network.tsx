import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useApi } from '../hooks/useApi';
import { formatNumber, truncateHash, timeAgo } from '../utils';
import GlowCard from '../components/GlowCard';
import StatCard from '../components/StatCard';
import Loader from '../components/Loader';
import TimeAgo from '../components/TimeAgo';
import NodeMap from '../components/NodeMap';
import type { NodeStats, NodeMapData, Peer, StakingInfo } from '@navio-blocks/shared';

/**
 * A peer is "active" only when we've personally interacted with it (RPC
 * peer or successful P2P `version`/`verack` handshake) within this window.
 * Gossip-only `last_seen` timestamps are intentionally ignored — the
 * network constantly re-gossips dead addresses with fresh `time` fields
 * and trusting them was painting almost every peer as ACTIVE.
 */
const ACTIVE_WINDOW_SECONDS = 3 * 60 * 60;

type PresenceState = 'listening' | 'active' | 'idle' | 'unknown';

function presenceState(peer: Peer, nowSec: number): PresenceState {
  if (peer.reachable === true) return 'listening';

  const handshake = peer.last_handshake;
  if (typeof handshake === 'number' && handshake > 0) {
    const age = nowSec - handshake;
    if (Number.isFinite(age) && age >= 0 && age <= ACTIVE_WINDOW_SECONDS) {
      return 'active';
    }
  }

  if (peer.reachable === false) return 'idle';
  return 'unknown';
}

function presenceRank(state: PresenceState): number {
  switch (state) {
    case 'listening':
      return 0;
    case 'active':
      return 1;
    case 'unknown':
      return 2;
    case 'idle':
    default:
      return 3;
  }
}

/** Strip a port suffix like ":8333" or "[::1]:8333", returning just the host. */
function hostFromAddr(addr: string): string {
  if (!addr) return '';
  if (addr.startsWith('[')) {
    const end = addr.indexOf(']');
    if (end > 0) return addr.slice(1, end);
  }
  const lastColon = addr.lastIndexOf(':');
  if (lastColon > 0 && !addr.includes('::') && addr.indexOf(':') === lastColon) {
    return addr.slice(0, lastColon);
  }
  return addr;
}

function isIpv4(host: string): boolean {
  return /^(\d{1,3}\.){3}\d{1,3}$/.test(host);
}

/**
 * Bucket a peer into a "same operator" group:
 * - IPv4 → /24 prefix (e.g. 203.0.113.0/24)
 * - IPv6 → /48 prefix (first 3 hextets)
 * - Hostnames → the hostname itself.
 *
 * /24 is the standard "single operator" heuristic Bitcoin Core uses for
 * addrman bucketing and is a great proxy for "10 IPs from one Tokyo DC".
 */
function subnetKey(addr: string): string {
  const host = hostFromAddr(addr);
  if (!host) return addr;

  if (isIpv4(host)) {
    const parts = host.split('.');
    return `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
  }

  if (host.includes(':')) {
    const hextets = host.split(':');
    while (hextets.length < 3) hextets.push('0');
    return `${hextets[0]}:${hextets[1]}:${hextets[2]}::/48`;
  }

  return host;
}

interface PeerGroup {
  key: string;
  label: string;
  peers: Peer[];
  representative: Peer;
  state: PresenceState;
  listeningCount: number;
  activeCount: number;
  totalCount: number;
  country: string;
  city: string;
  latestSeen: number;
}

function buildPeerGroups(peers: Peer[], nowSec: number): PeerGroup[] {
  const map = new Map<string, Peer[]>();
  for (const peer of peers) {
    const key = subnetKey(peer.addr);
    const existing = map.get(key);
    if (existing) existing.push(peer);
    else map.set(key, [peer]);
  }

  const groups: PeerGroup[] = [];
  for (const [key, members] of map.entries()) {
    members.sort((a, b) => {
      const ra = presenceRank(presenceState(a, nowSec));
      const rb = presenceRank(presenceState(b, nowSec));
      if (ra !== rb) return ra - rb;
      return (b.last_seen ?? 0) - (a.last_seen ?? 0);
    });

    const representative = members[0];
    const state = presenceState(representative, nowSec);
    let listeningCount = 0;
    let activeCount = 0;
    let latestSeen = 0;
    const countryCounts = new Map<string, number>();
    const cityCounts = new Map<string, number>();

    for (const m of members) {
      const s = presenceState(m, nowSec);
      if (s === 'listening') listeningCount++;
      if (s === 'listening' || s === 'active') activeCount++;
      if ((m.last_seen ?? 0) > latestSeen) latestSeen = m.last_seen ?? 0;
      const country = m.country?.trim();
      if (country) countryCounts.set(country, (countryCounts.get(country) ?? 0) + 1);
      const city = m.city?.trim();
      if (city) cityCounts.set(city, (cityCounts.get(city) ?? 0) + 1);
    }

    const country = [...countryCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
    const city = [...cityCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';

    groups.push({
      key,
      label: key,
      peers: members,
      representative,
      state,
      listeningCount,
      activeCount,
      totalCount: members.length,
      country,
      city,
      latestSeen,
    });
  }

  groups.sort((a, b) => {
    const ra = presenceRank(a.state);
    const rb = presenceRank(b.state);
    if (ra !== rb) return ra - rb;
    if (b.listeningCount !== a.listeningCount) return b.listeningCount - a.listeningCount;
    if (b.totalCount !== a.totalCount) return b.totalCount - a.totalCount;
    return b.latestSeen - a.latestSeen;
  });

  return groups;
}

function VersionBars({ versions }: { versions: { version: string; count: number }[] }) {
  const top = versions.slice(0, 8);
  const max = top.length > 0 ? top[0].count : 1;

  return (
    <div className="space-y-3">
      {top.map((v) => {
        const pct = Math.max((v.count / max) * 100, 2);
        return (
          <div key={v.version}>
            <div className="flex items-center justify-between mb-1">
              <span className="font-mono text-xs text-white/70 truncate mr-2" title={v.version}>
                {v.version}
              </span>
              <span className="font-mono text-xs text-white/40 shrink-0">
                {formatNumber(v.count)}
              </span>
            </div>
            <div className="h-2 rounded-full bg-white/5 overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-neon-pink via-neon-purple to-neon-blue transition-all duration-500"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CountryBars({ countries }: { countries: { country: string; count: number }[] }) {
  const top = countries.slice(0, 10);
  const max = top.length > 0 ? top[0].count : 1;

  return (
    <div className="space-y-3">
      {top.map((c) => {
        const pct = Math.max((c.count / max) * 100, 2);
        return (
          <div key={c.country}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-white/70">{c.country || 'Unknown'}</span>
              <span className="font-mono text-xs text-white/40">
                {formatNumber(c.count)}
              </span>
            </div>
            <div className="h-2 rounded-full bg-white/5 overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-neon-blue to-neon-purple transition-all duration-500"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '--';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  if (days > 365) return `${(days / 365).toFixed(1)}y`;
  if (days > 30) return `${(days / 30).toFixed(1)}mo`;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h`;
  const mins = Math.floor(seconds / 60);
  return `${mins}m`;
}

function StakingSection({ staking }: { staking: StakingInfo }) {
  return (
    <div className="space-y-4">
      {/* Staking stat cards */}


      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Age range */}
        <GlowCard hover={false}>
          <h3 className="text-sm font-semibold uppercase tracking-wider text-white/60 mb-4">
            Stake Age Overview
          </h3>
          {staking.oldest_stake_timestamp > 0 ? (
            <div className="mt-4 pt-3 border-t border-white/5 grid grid-cols-2 gap-4">
              <div>
                <p className="text-[10px] uppercase tracking-wider text-white/30 mb-0.5">Oldest Active Stake</p>
                <span className="font-mono text-xs text-white/70">{timeAgo(staking.oldest_stake_timestamp)}</span>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-white/30 mb-0.5">Newest Stake</p>
                <span className="font-mono text-xs text-white/70">{timeAgo(staking.newest_stake_timestamp)}</span>
              </div>
            </div>
          ) : (
            <p className="text-white/30 text-sm py-4 text-center">No active stakes found.</p>
          )}
        </GlowCard>

        {/* Stake list */}
        <GlowCard hover={false}>
          <h3 className="text-sm font-semibold uppercase tracking-wider text-white/60 mb-4">
            Active Stakes
          </h3>
          {staking.top_stakes.length > 0 ? (
            <div className="space-y-0">
              {staking.top_stakes.map((s, i) => (
                <div
                  key={s.output_hash}
                  className="flex items-center justify-between py-2.5 border-b border-white/5 last:border-b-0"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-xs font-mono text-white/30 w-5 text-right shrink-0">{i + 1}</span>
                    <Link
                      to={`/output/${s.output_hash}`}
                      className="font-mono text-xs text-neon-blue hover:text-neon-purple transition-colors truncate"
                      title={s.output_hash}
                    >
                      {truncateHash(s.output_hash, 8)}
                    </Link>
                  </div>
                  <div className="ml-2 shrink-0">
                    <span className="text-[10px] text-white/40 w-16 text-right block" title={`Block #${s.block_height}`}>
                      {formatDuration(s.age_seconds)} old
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-white/30 text-sm py-4 text-center">No active stakes found.</p>
          )}
        </GlowCard>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-2 gap-4">
        <StatCard label="Avg Stake Age" value={formatDuration(staking.avg_stake_age_seconds)} />
        <StatCard label="Active Stakes" value={formatNumber(staking.active_stakes)} />
      </div>
    </div>
  );
}

function SkeletonRow() {
  return (
    <tr className="border-b border-white/5">
      {Array.from({ length: 6 }, (_, i) => (
        <td key={i} className="px-4 py-3">
          <div className="skeleton h-4 rounded w-3/4" />
        </td>
      ))}
    </tr>
  );
}

function PresenceBadge({ state }: { state: PresenceState }) {
  if (state === 'listening') {
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-emerald-300"
        title="Accepts inbound connections on its advertised port"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]" />
        Listening
      </span>
    );
  }
  if (state === 'active') {
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-amber-300"
        title="Successfully handshook within the last 3 hours; not currently confirmed listening (likely behind NAT)"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.8)]" />
        Active
      </span>
    );
  }
  if (state === 'idle') {
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-white/45"
        title="Not reachable, no successful handshake in the last 3 hours"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-white/30" />
        Idle
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-white/40"
      title="Reachability not yet probed"
    >
      <span className="h-1.5 w-1.5 rounded-full bg-white/30" />
      Unknown
    </span>
  );
}

type StatusFilter = 'all' | 'listening' | 'active';
type GroupingMode = 'peer' | 'subnet';

function FilterPill({
  active,
  onClick,
  children,
  title,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
        active
          ? 'text-white bg-white/10 border-white/20'
          : 'text-white/50 border-white/10 hover:text-white hover:bg-white/5'
      }`}
    >
      {children}
    </button>
  );
}

export default function Network() {
  const { data: stats, loading: statsLoading, error: statsError } = useApi<NodeStats>(
    () => api.getNodes(),
    [],
  );
  const { data: mapData, loading: mapLoading } = useApi<NodeMapData>(
    () => api.getNodeMap(),
    [],
  );
  const { data: stakingData, loading: stakingLoading } = useApi<StakingInfo>(
    () => api.getStaking(),
    [],
  );

  const loading = statsLoading || mapLoading;

  const mostCommonVersion =
    stats && stats.versions.length > 0 ? stats.versions[0].version : '--';

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [grouping, setGrouping] = useState<GroupingMode>('peer');

  const nowSec = useMemo(() => Math.floor(Date.now() / 1000), [stats]);

  const annotatedPeers = useMemo(() => {
    if (!stats) return [] as Array<{ peer: Peer; state: PresenceState }>;
    return stats.peers.map((peer) => ({
      peer,
      state: presenceState(peer, nowSec),
    }));
  }, [stats, nowSec]);

  const filteredPeers = useMemo(() => {
    return annotatedPeers.filter(({ state }) => {
      if (statusFilter === 'listening') return state === 'listening';
      if (statusFilter === 'active') return state === 'listening' || state === 'active';
      return true;
    });
  }, [annotatedPeers, statusFilter]);

  const sortedPeers = useMemo(() => {
    return [...filteredPeers].sort((a, b) => {
      const ra = presenceRank(a.state);
      const rb = presenceRank(b.state);
      if (ra !== rb) return ra - rb;
      return (b.peer.last_seen ?? 0) - (a.peer.last_seen ?? 0);
    });
  }, [filteredPeers]);

  const peerGroups = useMemo(() => {
    if (grouping !== 'subnet') return [] as PeerGroup[];
    return buildPeerGroups(filteredPeers.map((p) => p.peer), nowSec);
  }, [filteredPeers, grouping, nowSec]);

  const activeNodes = useMemo(
    () =>
      annotatedPeers.reduce(
        (count, { state }) =>
          state === 'listening' || state === 'active' ? count + 1 : count,
        0,
      ),
    [annotatedPeers],
  );

  return (
    <div className="space-y-6">
      {/* Heading */}
      <h1 className="text-3xl font-bold gradient-text">Network</h1>

      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        {loading ? (
          <>
            <div className="glow-card"><div className="skeleton h-12 rounded" /></div>
            <div className="glow-card"><div className="skeleton h-12 rounded" /></div>
            <div className="glow-card"><div className="skeleton h-12 rounded" /></div>
            <div className="glow-card"><div className="skeleton h-12 rounded" /></div>
            <div className="glow-card"><div className="skeleton h-12 rounded" /></div>
          </>
        ) : stats ? (
          <>
            <StatCard label="Total Nodes" value={formatNumber(stats.total_nodes)} />
            <StatCard label="Listening" value={formatNumber(stats.listening_nodes)} />
            <StatCard label="Active (3h)" value={formatNumber(activeNodes)} />
            <StatCard label="Countries" value={formatNumber(stats.countries.length)} />
            <StatCard label="Most Common Version" value={mostCommonVersion} />
          </>
        ) : null}
      </div>

      {/* Node Map */}
      {mapLoading ? (
        <Loader text="Loading map..." />
      ) : mapData ? (
        <NodeMap peers={mapData.peers} />
      ) : null}

      {/* Version Distribution + Countries side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <GlowCard hover={false}>
          <h3 className="text-sm font-semibold uppercase tracking-wider text-white/60 mb-4">
            Version Distribution
          </h3>
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }, (_, i) => (
                <div key={i}>
                  <div className="skeleton h-3 rounded w-1/3 mb-1" />
                  <div className="skeleton h-2 rounded" />
                </div>
              ))}
            </div>
          ) : stats ? (
            <VersionBars versions={stats.versions} />
          ) : null}
        </GlowCard>

        <GlowCard hover={false}>
          <h3 className="text-sm font-semibold uppercase tracking-wider text-white/60 mb-4">
            Countries
          </h3>
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }, (_, i) => (
                <div key={i}>
                  <div className="skeleton h-3 rounded w-1/3 mb-1" />
                  <div className="skeleton h-2 rounded" />
                </div>
              ))}
            </div>
          ) : stats ? (
            <CountryBars countries={stats.countries} />
          ) : null}
        </GlowCard>
      </div>


      {/* Error state */}
      {statsError && (
        <GlowCard hover={false}>
          <div className="text-center py-8">
            <p className="text-white/50 text-sm">Failed to load network data.</p>
            <p className="text-white/30 text-xs font-mono mt-1">{statsError}</p>
          </div>
        </GlowCard>
      )}

      {/* Full Peer Table */}
      <GlowCard hover={false} className="overflow-hidden">
        <div className="flex flex-wrap items-end justify-between gap-4 px-4 pt-4 pb-2">
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wider text-white/60">
              All Peers
            </h3>
            {!loading && stats && (
              <p className="text-[11px] text-white/35 mt-1">
                {grouping === 'subnet'
                  ? `${formatNumber(peerGroups.length)} group${peerGroups.length === 1 ? '' : 's'} · ${formatNumber(filteredPeers.length)} peer${filteredPeers.length === 1 ? '' : 's'}`
                  : `${formatNumber(sortedPeers.length)} peer${sortedPeers.length === 1 ? '' : 's'}`}
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wider text-white/40 mb-1.5">
                Status
              </p>
              <div className="flex gap-1.5">
                <FilterPill
                  active={statusFilter === 'all'}
                  onClick={() => setStatusFilter('all')}
                  title="Show every known peer"
                >
                  All
                </FilterPill>
                <FilterPill
                  active={statusFilter === 'listening'}
                  onClick={() => setStatusFilter('listening')}
                  title="Only peers we successfully reach on their advertised port"
                >
                  Listening
                </FilterPill>
                <FilterPill
                  active={statusFilter === 'active'}
                  onClick={() => setStatusFilter('active')}
                  title="Peers we successfully handshook with in the last 3 hours, including non-listening ones"
                >
                  Active (3h)
                </FilterPill>
              </div>
            </div>
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wider text-white/40 mb-1.5">
                Group
              </p>
              <div className="flex gap-1.5">
                <FilterPill
                  active={grouping === 'peer'}
                  onClick={() => setGrouping('peer')}
                  title="One row per peer"
                >
                  Per peer
                </FilterPill>
                <FilterPill
                  active={grouping === 'subnet'}
                  onClick={() => setGrouping('subnet')}
                  title="Collapse peers in the same /24 (IPv4) or /48 (IPv6) network — likely the same operator"
                >
                  By /24 subnet
                </FilterPill>
              </div>
            </div>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-white/10">
                <th className="px-4 py-3 text-[10px] uppercase tracking-wider text-white/40 font-medium">
                  {grouping === 'subnet' ? 'Subnet' : 'Address'}
                </th>
                <th className="px-4 py-3 text-[10px] uppercase tracking-wider text-white/40 font-medium">
                  Status
                </th>
                <th className="px-4 py-3 text-[10px] uppercase tracking-wider text-white/40 font-medium">
                  {grouping === 'subnet' ? 'Peers' : 'Version'}
                </th>
                <th className="px-4 py-3 text-[10px] uppercase tracking-wider text-white/40 font-medium">
                  Country
                </th>
                <th className="px-4 py-3 text-[10px] uppercase tracking-wider text-white/40 font-medium">
                  City
                </th>
                <th className="px-4 py-3 text-[10px] uppercase tracking-wider text-white/40 font-medium">
                  Last Seen
                </th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 8 }, (_, i) => <SkeletonRow key={i} />)
              ) : stats && grouping === 'subnet' && peerGroups.length > 0 ? (
                peerGroups.map((group) => (
                  <tr
                    key={group.key}
                    className="border-b border-white/5 hover:bg-white/[0.02] transition-colors"
                    title={group.peers.map((p) => p.addr).join('\n')}
                  >
                    <td className="px-4 py-3 font-mono text-xs text-white/80">
                      {group.label}
                    </td>
                    <td className="px-4 py-3">
                      <PresenceBadge state={group.state} />
                    </td>
                    <td className="px-4 py-3 text-xs text-white/70">
                      <span className="font-mono">{formatNumber(group.totalCount)}</span>
                      {group.totalCount > 1 && (
                        <span className="text-white/40 ml-1.5">
                          ({formatNumber(group.listeningCount)} listening
                          {group.activeCount - group.listeningCount > 0
                            ? `, ${formatNumber(group.activeCount - group.listeningCount)} active`
                            : ''})
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-white/60">
                      {group.country || '--'}
                    </td>
                    <td className="px-4 py-3 text-xs text-white/60">
                      {group.city || '--'}
                    </td>
                    <td className="px-4 py-3">
                      <TimeAgo timestamp={group.latestSeen} />
                    </td>
                  </tr>
                ))
              ) : stats && grouping === 'peer' && sortedPeers.length > 0 ? (
                sortedPeers.map(({ peer, state }) => (
                  <tr
                    key={peer.id}
                    className="border-b border-white/5 hover:bg-white/[0.02] transition-colors"
                  >
                    <td className="px-4 py-3 font-mono text-xs text-white/80">
                      {peer.addr}
                    </td>
                    <td className="px-4 py-3">
                      <PresenceBadge state={state} />
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-white/60">
                      {peer.subversion}
                    </td>
                    <td className="px-4 py-3 text-xs text-white/60">
                      {peer.country || '--'}
                    </td>
                    <td className="px-4 py-3 text-xs text-white/60">
                      {peer.city || '--'}
                    </td>
                    <td className="px-4 py-3">
                      <TimeAgo timestamp={peer.last_seen} />
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-white/30 text-sm">
                    No peers match the current filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </GlowCard>
      {/* Staking Tracker */}
      <div className="space-y-2">
        <h2 className="text-xl font-bold text-white">Staking Tracker</h2>
        <p className="text-xs text-white/40">Active staked commitment outputs on the network.</p>
      </div>
      {stakingLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="glow-card"><div className="skeleton h-12 rounded" /></div>
          ))}
        </div>
      ) : stakingData ? (
        <StakingSection staking={stakingData} />
      ) : null}

    </div>
  );
}
