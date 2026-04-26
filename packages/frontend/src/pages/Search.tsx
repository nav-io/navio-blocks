import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { formatNumber, truncateHash } from '../utils';
import Loader from '../components/Loader';
import type { Block, Transaction, SearchResult } from '@navio-blocks/shared';

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="text-lg font-semibold text-white/90 border-b border-white/10 pb-2 mb-3">
      {children}
    </h2>
  );
}

export default function Search() {
  const [searchParams] = useSearchParams();
  const q = (searchParams.get('q') ?? '').trim();
  const [data, setData] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!q) {
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .search(q)
      .then((result) => {
        if (!cancelled) {
          setData(result);
          setLoading(false);
        }
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setError(err.message);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [q]);

  const matches = data?.type === 'multi' ? data.matches : undefined;

  return (
    <div className="min-h-screen">
      <div className="max-w-6xl mx-auto px-4 py-12">
        <h1 className="text-3xl sm:text-4xl font-bold gradient-text mb-2">Search</h1>
        {q ? (
          <p className="text-white/50 font-mono text-sm mb-8 break-all">
            Results for <span className="text-neon-blue/90">{q}</span>
          </p>
        ) : (
          <p className="text-white/45 text-sm mb-8">Enter a query in the search bar.</p>
        )}

        {!q && (
          <div className="glow-card py-10 text-center text-white/50 text-sm">
            No search query in the URL. Use the header search with a partial or full hash.
          </div>
        )}

        {q && error && (
          <div className="glow-card text-center py-10">
            <p className="text-neon-pink text-lg mb-2">Search failed</p>
            <p className="text-gray-400 text-sm">{error}</p>
          </div>
        )}

        {q && loading && <Loader text="Searching..." />}

        {q && !loading && !error && data?.type === 'none' && (
          <div className="glow-card py-10 text-center">
            <p className="text-white/70">No results for this query.</p>
            <p className="text-white/40 text-sm mt-2">
              Partial hashes need at least 4 hex characters. Try a full block hash, txid, or output hash.
            </p>
          </div>
        )}

        {q && !loading && !error && matches && (
          <div className="space-y-10">
            {matches.blocks.length > 0 && (
              <section>
                <SectionTitle>Blocks ({matches.blocks.length})</SectionTitle>
                <ul className="space-y-2">
                  {matches.blocks.map((block: Block) => (
                    <li key={block.height}>
                      <Link
                        to={`/block/${block.height}`}
                        className="flex flex-wrap items-baseline gap-x-4 gap-y-1 font-mono text-sm text-neon-blue hover:text-neon-purple transition-colors"
                      >
                        <span>#{formatNumber(block.height)}</span>
                        <span className="text-white/50 break-all">{block.hash}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {matches.transactions.length > 0 && (
              <section>
                <SectionTitle>Transactions ({matches.transactions.length})</SectionTitle>
                <ul className="space-y-2">
                  {matches.transactions.map((tx: Transaction) => (
                    <li key={tx.txid}>
                      <Link
                        to={`/tx/${tx.txid}`}
                        className="block font-mono text-sm text-neon-blue hover:text-neon-purple transition-colors break-all"
                      >
                        {tx.txid}
                      </Link>
                      <span className="text-xs text-white/35 ml-0">
                        block {formatNumber(tx.block_height)}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {matches.output_hashes.length > 0 && (
              <section>
                <SectionTitle>Outputs ({matches.output_hashes.length})</SectionTitle>
                <ul className="space-y-2">
                  {matches.output_hashes.map((hash) => (
                    <li key={hash}>
                      <Link
                        to={`/output/${hash}`}
                        className="block font-mono text-sm text-neon-blue hover:text-neon-purple transition-colors break-all"
                      >
                        {truncateHash(hash, 12)}
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {matches.token_ids.length > 0 && (
              <section>
                <SectionTitle>Tokens / NFT collections ({matches.token_ids.length})</SectionTitle>
                <ul className="space-y-2">
                  {matches.token_ids.map((tokenId) => (
                    <li key={tokenId}>
                      <Link
                        to={`/token/${encodeURIComponent(tokenId)}`}
                        className="block font-mono text-sm text-neon-blue hover:text-neon-purple transition-colors break-all"
                      >
                        {tokenId}
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
