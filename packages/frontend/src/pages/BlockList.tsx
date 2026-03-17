import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useApi } from '../hooks/useApi';
import { formatNumber, truncateHash, formatBytes, timeAgo } from '../utils';
import { Pagination } from '../components/Pagination';
import Loader from '../components/Loader';
import type { Block } from '@navio-blocks/shared';

const PAGE_SIZE = 20;

export default function BlockList() {
  const [searchParams, setSearchParams] = useSearchParams();
  const page = Math.max(1, Number(searchParams.get('page')) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  const { data, loading, error } = useApi(
    () => api.getBlocks(PAGE_SIZE, offset),
    [page]
  );

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 0;

  const handlePageChange = (newPage: number) => {
    setSearchParams(newPage > 1 ? { page: String(newPage) } : {});
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="grid-bg min-h-screen">
      <div className="max-w-6xl mx-auto px-4 py-12">
        <h1 className="text-3xl sm:text-4xl font-bold gradient-text mb-8">Blocks</h1>

        {error && (
          <div className="glow-card text-center py-10">
            <p className="text-neon-pink text-lg mb-2">Error loading blocks</p>
            <p className="text-gray-400 text-sm">{error}</p>
          </div>
        )}

        {loading && <Loader text="Loading blocks..." />}

        {!loading && !error && data && (
          <>
            {/* Desktop table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10 text-gray-400">
                    <th className="text-left py-3 px-4 font-medium">Height</th>
                    <th className="text-left py-3 px-4 font-medium">Hash</th>
                    <th className="text-right py-3 px-4 font-medium">Transactions</th>
                    <th className="text-right py-3 px-4 font-medium">Size</th>
                    <th className="text-right py-3 px-4 font-medium">Time</th>
                  </tr>
                </thead>
                <tbody>
                  {data.data.map((block: Block) => (
                    <tr
                      key={block.height}
                      className="border-b border-white/5 hover:bg-navy-lighter/50 transition-colors"
                    >
                      <td className="py-3 px-4">
                        <Link
                          to={`/block/${block.height}`}
                          className="font-mono text-neon-blue hover:text-neon-purple transition-colors"
                        >
                          {formatNumber(block.height)}
                        </Link>
                        {block.is_pos && (
                          <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-500/20 text-green-400 border border-green-500/30">
                            PoS
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 font-mono text-gray-400">
                        {truncateHash(block.hash, 10)}
                      </td>
                      <td className="py-3 px-4 text-right text-gray-300">
                        {formatNumber(block.tx_count)}
                      </td>
                      <td className="py-3 px-4 text-right text-gray-400">
                        {formatBytes(block.size)}
                      </td>
                      <td className="py-3 px-4 text-right text-gray-500 whitespace-nowrap">
                        {timeAgo(block.timestamp)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile card layout */}
            <div className="md:hidden space-y-3">
              {data.data.map((block: Block) => (
                <Link
                  key={block.height}
                  to={`/block/${block.height}`}
                  className="glow-card block"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-mono text-neon-blue font-medium">
                      #{formatNumber(block.height)}
                    </span>
                    <span className="text-xs text-gray-500">{timeAgo(block.timestamp)}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-400">{block.tx_count} txs</span>
                    <span className="text-gray-500">{formatBytes(block.size)}</span>
                  </div>
                  {block.is_pos && (
                    <span className="inline-block mt-2 px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-500/20 text-green-400 border border-green-500/30">
                      PoS
                    </span>
                  )}
                </Link>
              ))}
            </div>

            <Pagination
              currentPage={page}
              totalPages={totalPages}
              onPageChange={handlePageChange}
            />
          </>
        )}
      </div>
    </div>
  );
}
