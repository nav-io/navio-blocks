import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api";
import { useApi } from "../hooks/useApi";
import { formatNumber, satsToCoin, timeAgo, truncateHash } from "../utils";
import GlowCard from "../components/GlowCard";
import Loader from "../components/Loader";
import CopyButton from "../components/CopyButton";
import { Pagination } from "../components/Pagination";
import type { NftDetail as NftDetailType, TokenActivity } from "@navio-blocks/shared";

const PAGE_SIZE = 20;

function ActivityRow({ item }: { item: TokenActivity }) {
  return (
    <tr className="border-b border-white/5 last:border-b-0">
      <td className="py-3 pr-4">
        <Link
          to={`/output/${item.output_hash}`}
          className="font-mono text-sm text-neon-blue hover:text-neon-purple transition-colors"
          title={item.output_hash}
        >
          {truncateHash(item.output_hash, 9)}
        </Link>
      </td>
      <td className="py-3 pr-4">
        <Link
          to={`/tx/${item.txid}`}
          className="font-mono text-sm text-neon-blue hover:text-neon-purple transition-colors"
          title={item.txid}
        >
          {truncateHash(item.txid, 9)}
        </Link>
      </td>
      <td className="py-3 pr-4 font-mono text-xs text-white/70">
        {item.value_sat != null && item.value_sat > 0 ? `${satsToCoin(item.value_sat)} NAV` : "—"}
      </td>
      <td className="py-3 pr-4">
        <span
          className={`inline-block rounded px-2 py-0.5 text-[10px] font-mono font-medium border ${
            item.spent
              ? "bg-rose-500/20 text-rose-200 border-rose-500/30"
              : "bg-emerald-500/20 text-emerald-200 border-emerald-500/30"
          }`}
        >
          {item.spent ? "Spent" : "Unspent"}
        </span>
      </td>
      <td className="py-3 text-right text-xs text-gray-400 whitespace-nowrap">
        {timeAgo(item.timestamp)}
      </td>
    </tr>
  );
}

export default function NftDetail() {
  const { tokenId, index } = useParams<{ tokenId: string; index: string }>();
  const [page, setPage] = useState(1);
  const offset = (page - 1) * PAGE_SIZE;

  const { data, loading, error } = useApi<NftDetailType>(
    () => api.getNft(tokenId!, index!, PAGE_SIZE, offset),
    [tokenId, index, page],
  );

  if (loading) return <Loader text="Loading NFT details..." />;

  if (error || !data) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <div className="text-6xl mb-4">404</div>
        <h2 className="text-xl font-semibold text-white mb-2">NFT not found</h2>
        <p className="text-white/40 font-mono text-sm mb-6">
          {tokenId && index ? `${tokenId}#${index}` : "Unknown NFT"}
        </p>
        <Link
          to="/tokens"
          className="px-4 py-2 rounded-lg bg-gradient-to-r from-neon-pink to-neon-purple text-white text-sm font-medium hover:opacity-90 transition-opacity"
        >
          Back to Tokens
        </Link>
      </div>
    );
  }

  const totalPages = Math.ceil(data.total_activity / PAGE_SIZE);

  return (
    <div className="space-y-6">
      <GlowCard hover={false}>
        <div className="space-y-5">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-white/40 mb-1.5">NFT ID</p>
            <div className="flex items-center gap-2">
              <span className="font-mono text-lg text-white break-all leading-relaxed">{data.nft_id}</span>
              <CopyButton text={data.nft_id} />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-block rounded px-2 py-0.5 text-xs font-mono font-medium border bg-indigo-500/20 text-indigo-300 border-indigo-500/30">
              NFT
            </span>
            <Link
              to={`/token/${data.token_id}`}
              className="text-xs font-mono text-neon-blue hover:text-neon-purple transition-colors"
            >
              Collection {truncateHash(data.token_id, 10)}
            </Link>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-white/30 mb-0.5">Outputs</p>
              <span className="font-mono text-sm text-white">{formatNumber(data.output_count)}</span>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-white/30 mb-0.5">Transactions</p>
              <span className="font-mono text-sm text-white">{formatNumber(data.tx_count)}</span>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-white/30 mb-0.5">Collection Type</p>
              <span className="font-mono text-sm text-white uppercase">{data.collection_type}</span>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-white/30 mb-0.5">Max Supply</p>
              <span className="font-mono text-sm text-white">
                {data.max_supply != null ? formatNumber(data.max_supply) : "—"}
              </span>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-white/30 mb-0.5">Current Owner</p>
              {data.current_owner_output_hash ? (
                <Link
                  to={`/output/${data.current_owner_output_hash}`}
                  className="font-mono text-sm text-neon-blue hover:text-neon-purple transition-colors"
                >
                  {truncateHash(data.current_owner_output_hash, 8)}
                </Link>
              ) : (
                <span className="font-mono text-sm text-white/40">Unknown</span>
              )}
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-white/30 mb-0.5">Last Activity</p>
              <span className="font-mono text-sm text-white">
                {data.last_seen_timestamp ? timeAgo(data.last_seen_timestamp) : "—"}
              </span>
            </div>
          </div>
        </div>
      </GlowCard>

      {data.nft_metadata.length > 0 && (
        <GlowCard hover={false}>
          <h3 className="text-sm font-semibold uppercase tracking-wider text-white/60 mb-3">NFT Metadata</h3>
          <div className="space-y-2">
            {data.nft_metadata.map((entry) => (
              <div key={`${entry.key}:${entry.value}`} className="flex items-start gap-2">
                <span className="text-[10px] uppercase tracking-wider text-white/30 min-w-24">{entry.key}</span>
                <span className="font-mono text-sm text-white break-all">{entry.value}</span>
              </div>
            ))}
          </div>
        </GlowCard>
      )}

      {data.collection_metadata.length > 0 && (
        <GlowCard hover={false}>
          <h3 className="text-sm font-semibold uppercase tracking-wider text-white/60 mb-3">Collection Metadata</h3>
          <div className="space-y-2">
            {data.collection_metadata.map((entry) => (
              <div key={`${entry.key}:${entry.value}`} className="flex items-start gap-2">
                <span className="text-[10px] uppercase tracking-wider text-white/30 min-w-24">{entry.key}</span>
                <span className="font-mono text-sm text-white break-all">{entry.value}</span>
              </div>
            ))}
          </div>
        </GlowCard>
      )}

      <GlowCard hover={false}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-white/60">Activity</h3>
          <span className="text-xs font-mono text-white/40">
            {formatNumber(data.total_activity)} outputs
          </span>
        </div>
        {data.activity.length > 0 ? (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10">
                    <th className="text-left text-[10px] uppercase tracking-wider text-white/40 pb-3 pr-4">Output</th>
                    <th className="text-left text-[10px] uppercase tracking-wider text-white/40 pb-3 pr-4">Tx</th>
                    <th className="text-left text-[10px] uppercase tracking-wider text-white/40 pb-3 pr-4">Value</th>
                    <th className="text-left text-[10px] uppercase tracking-wider text-white/40 pb-3 pr-4">Status</th>
                    <th className="text-right text-[10px] uppercase tracking-wider text-white/40 pb-3">Time</th>
                  </tr>
                </thead>
                <tbody>
                  {data.activity.map((item) => (
                    <ActivityRow key={item.output_hash} item={item} />
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />
          </>
        ) : (
          <p className="text-sm text-white/40">No activity found.</p>
        )}
      </GlowCard>
    </div>
  );
}

