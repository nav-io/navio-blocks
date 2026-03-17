import { api } from '../api';
import { useApi } from '../hooks/useApi';
import { formatNumber } from '../utils';
import GlowCard from '../components/GlowCard';
import StatCard from '../components/StatCard';
import Loader from '../components/Loader';
import TimeAgo from '../components/TimeAgo';
import NodeMap from '../components/NodeMap';
import type { NodeStats, NodeMapData } from '@navio-blocks/shared';

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

function SkeletonRow() {
  return (
    <tr className="border-b border-white/5">
      {Array.from({ length: 5 }, (_, i) => (
        <td key={i} className="px-4 py-3">
          <div className="skeleton h-4 rounded w-3/4" />
        </td>
      ))}
    </tr>
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

  const loading = statsLoading || mapLoading;

  const mostCommonVersion =
    stats && stats.versions.length > 0 ? stats.versions[0].version : '--';

  return (
    <div className="space-y-6">
      {/* Heading */}
      <h1 className="text-3xl font-bold gradient-text">Network</h1>

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {loading ? (
          <>
            <div className="glow-card"><div className="skeleton h-12 rounded" /></div>
            <div className="glow-card"><div className="skeleton h-12 rounded" /></div>
            <div className="glow-card"><div className="skeleton h-12 rounded" /></div>
          </>
        ) : stats ? (
          <>
            <StatCard label="Total Nodes" value={formatNumber(stats.total_nodes)} />
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
        <h3 className="text-sm font-semibold uppercase tracking-wider text-white/60 mb-4 px-4 pt-4">
          All Peers
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-white/10">
                <th className="px-4 py-3 text-[10px] uppercase tracking-wider text-white/40 font-medium">
                  Address
                </th>
                <th className="px-4 py-3 text-[10px] uppercase tracking-wider text-white/40 font-medium">
                  Version
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
              ) : stats && stats.peers.length > 0 ? (
                stats.peers.map((peer) => (
                  <tr
                    key={peer.id}
                    className="border-b border-white/5 hover:bg-white/[0.02] transition-colors"
                  >
                    <td className="px-4 py-3 font-mono text-xs text-white/80">
                      {peer.addr}
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
                  <td colSpan={5} className="px-4 py-8 text-center text-white/30 text-sm">
                    No peers found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </GlowCard>
    </div>
  );
}
