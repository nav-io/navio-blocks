import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api";
import { useApi } from "../hooks/useApi";
import { formatNumber, satsToCoin, splitTokenId, timeAgo, truncateHash } from "../utils";
import GlowCard from "../components/GlowCard";
import Loader from "../components/Loader";
import CopyButton from "../components/CopyButton";
import { Pagination } from "../components/Pagination";
import type { TokenActivity, TokenDetail as TokenDetailType } from "@navio-blocks/shared";

const PAGE_SIZE = 20;

function ActivityRow({ item }: { item: TokenActivity }) {
  const tokenParts = splitTokenId(item.token_id);

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
      <td className="py-3 pr-4">
        {tokenParts?.nftIndex ? (
          <Link
            to={`/nft/${tokenParts.base}/${tokenParts.nftIndex}`}
            className="font-mono text-xs text-neon-blue hover:text-neon-purple transition-colors"
          >
            #{tokenParts.nftIndex}
          </Link>
        ) : (
          <span className="font-mono text-xs text-white/70">{truncateHash(item.token_id ?? "", 8)}</span>
        )}
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

export default function TokenDetail() {
  const { tokenId } = useParams<{ tokenId: string }>();
  const [page, setPage] = useState(1);
  const offset = (page - 1) * PAGE_SIZE;

  const { data, loading, error } = useApi<TokenDetailType>(
    () => api.getToken(tokenId!, PAGE_SIZE, offset),
    [tokenId, page],
  );

  if (loading) return <Loader text="Loading token details..." />;

  if (error || !data) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <div className="text-6xl mb-4">404</div>
        <h2 className="text-xl font-semibold text-white mb-2">Token not found</h2>
        <p className="text-white/40 font-mono text-sm mb-6">{tokenId ?? "Unknown token ID"}</p>
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
            <p className="text-xs font-medium uppercase tracking-wider text-white/40 mb-1.5">Token ID</p>
            <div className="flex items-center gap-2">
              <span className="font-mono text-lg text-white break-all leading-relaxed">{data.token_id}</span>
              <CopyButton text={data.token_id} />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-block rounded px-2 py-0.5 text-xs font-mono font-medium border ${
                data.type === "nft"
                  ? "bg-indigo-500/20 text-indigo-300 border-indigo-500/30"
                  : "bg-teal-500/20 text-teal-300 border-teal-500/30"
              }`}
            >
              {data.type === "nft" ? "NFT Collection" : "Token"}
            </span>
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
              <p className="text-[10px] uppercase tracking-wider text-white/30 mb-0.5">Mint Events</p>
              <span className="font-mono text-sm text-white">{formatNumber(data.mint_event_count)}</span>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-white/30 mb-0.5">NFTs Minted</p>
              <span className="font-mono text-sm text-white">{formatNumber(data.minted_nft_count)}</span>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-white/30 mb-0.5">Max Supply</p>
              <span className="font-mono text-sm text-white">
                {data.max_supply != null ? formatNumber(data.max_supply) : "—"}
              </span>
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

      {data.metadata.length > 0 && (
        <GlowCard hover={false}>
          <h3 className="text-sm font-semibold uppercase tracking-wider text-white/60 mb-3">Token Metadata</h3>
          <div className="space-y-2">
            {data.metadata.map((entry) => (
              <div key={`${entry.key}:${entry.value}`} className="flex items-start gap-2">
                <span className="text-[10px] uppercase tracking-wider text-white/30 min-w-24">{entry.key}</span>
                <span className="font-mono text-sm text-white break-all">{entry.value}</span>
              </div>
            ))}
          </div>
        </GlowCard>
      )}

      {data.minted_nft.length > 0 && (
        <GlowCard hover={false}>
          <h3 className="text-sm font-semibold uppercase tracking-wider text-white/60 mb-3">Minted NFTs</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="text-left text-[10px] uppercase tracking-wider text-white/40 pb-3 pr-4">Index</th>
                  <th className="text-left text-[10px] uppercase tracking-wider text-white/40 pb-3">Metadata</th>
                </tr>
              </thead>
              <tbody>
                {data.minted_nft.map((nft) => (
                  <tr key={nft.index} className="border-b border-white/5 last:border-b-0">
                    <td className="py-3 pr-4">
                      <Link
                        to={`/nft/${data.token_id}/${nft.index}`}
                        className="font-mono text-sm text-neon-blue hover:text-neon-purple transition-colors"
                      >
                        #{nft.index}
                      </Link>
                    </td>
                    <td className="py-3">
                      {nft.metadata.length > 0 ? (
                        <div className="text-xs text-white/70">
                          {nft.metadata.map((entry) => `${entry.key}: ${entry.value}`).join(" · ")}
                        </div>
                      ) : (
                        <span className="text-xs text-white/40">No metadata</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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
                    <th className="text-left text-[10px] uppercase tracking-wider text-white/40 pb-3 pr-4">Token</th>
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

