import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useApi } from "../hooks/useApi";
import { formatNumber, timeAgo, truncateHash } from "../utils";
import { Pagination } from "../components/Pagination";
import GlowCard from "../components/GlowCard";
import Loader from "../components/Loader";
import type { PaginatedResponse, TokenSummary } from "@navio-blocks/shared";

const PAGE_SIZE = 20;
type TokenFilter = "all" | "token" | "nft";

function displayName(token: TokenSummary): string | null {
  const preferredKeys = ["name", "symbol", "ticker", "collection", "title"];
  for (const key of preferredKeys) {
    const found = token.metadata.find((entry) => entry.key.toLowerCase() === key);
    if (found) return found.value;
  }
  return token.metadata[0]?.value ?? null;
}

export default function Tokens() {
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState<TokenFilter>("all");

  const { data, loading } = useApi<PaginatedResponse<TokenSummary>>(
    () => api.getTokens(PAGE_SIZE, (page - 1) * PAGE_SIZE, filter),
    [page, filter],
  );

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 0;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-white">Tokens & NFTs</h1>

      <GlowCard hover={false}>
        <div className="flex flex-wrap gap-1.5">
          {(["all", "token", "nft"] as const).map((kind) => (
            <button
              key={kind}
              onClick={() => {
                setFilter(kind);
                setPage(1);
              }}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                filter === kind
                  ? "text-white bg-white/10 border-white/20"
                  : "text-white/50 border-white/10 hover:text-white hover:bg-white/5"
              }`}
            >
              {kind === "all" ? "All" : kind === "token" ? "Tokens" : "NFT Collections"}
            </button>
          ))}
        </div>
      </GlowCard>

      {loading ? (
        <Loader text="Loading token collections..." />
      ) : data && data.data.length > 0 ? (
        <GlowCard hover={false}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="text-left text-[10px] uppercase tracking-wider text-white/40 pb-3 pr-4">Collection</th>
                  <th className="text-left text-[10px] uppercase tracking-wider text-white/40 pb-3 pr-4">Type</th>
                  <th className="text-left text-[10px] uppercase tracking-wider text-white/40 pb-3 pr-4">Metadata</th>
                  <th className="text-right text-[10px] uppercase tracking-wider text-white/40 pb-3 pr-4">Outputs</th>
                  <th className="text-right text-[10px] uppercase tracking-wider text-white/40 pb-3 pr-4">Txs</th>
                  <th className="text-right text-[10px] uppercase tracking-wider text-white/40 pb-3">Last Seen</th>
                </tr>
              </thead>
              <tbody>
                {data.data.map((token) => {
                  const name = displayName(token);
                  return (
                    <tr key={token.token_id} className="border-b border-white/5 last:border-b-0">
                      <td className="py-3 pr-4">
                        <Link
                          to={`/token/${token.token_id}`}
                          className="font-mono text-sm text-neon-blue hover:text-neon-purple transition-colors"
                          title={token.token_id}
                        >
                          {truncateHash(token.token_id, 10)}
                        </Link>
                      </td>
                      <td className="py-3 pr-4">
                        <span
                          className={`inline-block rounded px-2 py-0.5 text-xs font-mono font-medium border ${
                            token.type === "nft"
                              ? "bg-indigo-500/20 text-indigo-300 border-indigo-500/30"
                              : "bg-teal-500/20 text-teal-300 border-teal-500/30"
                          }`}
                        >
                          {token.type === "nft" ? "NFT" : "Token"}
                        </span>
                      </td>
                      <td className="py-3 pr-4">
                        <div className="text-xs text-white/80">
                          {name ?? "No metadata"}
                        </div>
                        {token.type === "nft" && token.minted_nft_count > 0 && (
                          <div className="text-[11px] text-white/40 font-mono">
                            {formatNumber(token.minted_nft_count)} minted
                          </div>
                        )}
                      </td>
                      <td className="py-3 pr-4 text-right font-mono text-white/80">
                        {formatNumber(token.output_count)}
                      </td>
                      <td className="py-3 pr-4 text-right font-mono text-white/80">
                        {formatNumber(token.tx_count)}
                      </td>
                      <td className="py-3 text-right text-xs text-gray-400 whitespace-nowrap">
                        {token.last_seen_timestamp ? timeAgo(token.last_seen_timestamp) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />
        </GlowCard>
      ) : (
        <GlowCard hover={false}>
          <p className="text-gray-500 text-sm py-4 text-center">No indexed token collections found.</p>
        </GlowCard>
      )}
    </div>
  );
}

