import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useApi } from '../hooks/useApi';
import {
  timeAgo,
  formatNumber,
  truncateHash,
  formatDifficulty,
  formatBytes,
  satsToCoin,
} from '../utils';
import GlowCard from '../components/GlowCard';
import PrivacyBadge from '../components/PrivacyBadge';
import { Pagination } from '../components/Pagination';
import Loader from '../components/Loader';
import type { Transaction, BlockSupply } from '@navio-blocks/shared';

const TX_PAGE_SIZE = 20;

function formatSignedNav(sats: number): string {
  const sign = sats > 0 ? '+' : sats < 0 ? '-' : '';
  return `${sign}${satsToCoin(Math.abs(sats))} NAV`;
}

function CopyButton({ text }: { text: string }) {
  const handleCopy = () => {
    navigator.clipboard.writeText(text).catch(() => {});
  };

  return (
    <button
      onClick={handleCopy}
      title="Copy to clipboard"
      className="ml-2 text-gray-500 hover:text-neon-purple transition-colors"
    >
      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
        <path d="M8 3a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1z" />
        <path d="M6 3a2 2 0 00-2 2v11a2 2 0 002 2h8a2 2 0 002-2V5a2 2 0 00-2-2 3 3 0 01-3 3H9a3 3 0 01-3-3z" />
      </svg>
    </button>
  );
}

function DetailItem({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="py-3 border-b border-white/5 last:border-b-0">
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <div className="text-sm text-gray-200 font-mono break-all">{children}</div>
    </div>
  );
}

export default function BlockDetail() {
  const { id } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const txPage = Math.max(1, Number(searchParams.get('txPage')) || 1);
  const txOffset = (txPage - 1) * TX_PAGE_SIZE;

  const {
    data: block,
    loading: blockLoading,
    error: blockError,
  } = useApi(() => api.getBlock(id!), [id]);

  const {
    data: txsRes,
    loading: txsLoading,
  } = useApi(
    () => (id ? api.getBlockTxs(id, TX_PAGE_SIZE, txOffset) : Promise.resolve({ data: [] as Transaction[], total: 0, limit: TX_PAGE_SIZE, offset: 0 })),
    [id, txPage]
  );

  const { data: supply } = useApi<BlockSupply | null>(
    () => (block ? api.getSupplyBlock(block.height) : Promise.resolve(null)),
    [block?.height]
  );

  const txTotalPages = txsRes ? Math.ceil(txsRes.total / TX_PAGE_SIZE) : 0;

  const handleTxPageChange = (newPage: number) => {
    setSearchParams(newPage > 1 ? { txPage: String(newPage) } : {});
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  if (blockLoading) {
    return (
      <div className="grid-bg min-h-screen">
        <div className="max-w-6xl mx-auto px-4 py-12">
          <Loader text="Loading block..." />
        </div>
      </div>
    );
  }

  if (blockError || !block) {
    return (
      <div className="grid-bg min-h-screen">
        <div className="max-w-6xl mx-auto px-4 py-12">
          <div className="glow-card text-center py-16">
            <p className="text-neon-pink text-xl mb-2">Block not found</p>
            <p className="text-gray-400 text-sm mb-6">
              {blockError || `Could not find block "${id}".`}
            </p>
            <Link
              to="/blocks"
              className="text-neon-purple hover:text-neon-pink transition-colors text-sm"
            >
              Browse all blocks
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const prevHeight = block.height - 1;
  const nextHeight = block.height + 1;
  const netSupplyDelta = supply ? supply.block_reward - supply.fees_burned : null;

  return (
    <div className="grid-bg min-h-screen">
      <div className="max-w-6xl mx-auto px-4 py-12">
        {/* Navigation arrows */}
        <div className="flex items-center justify-between mb-6">
          <Link
            to={`/block/${prevHeight}`}
            className={`flex items-center gap-2 text-sm transition-colors ${
              prevHeight >= 0
                ? 'text-gray-400 hover:text-neon-purple'
                : 'text-gray-700 pointer-events-none'
            }`}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
            </svg>
            Block #{formatNumber(prevHeight)}
          </Link>
          <Link
            to={`/block/${nextHeight}`}
            className="flex items-center gap-2 text-sm text-gray-400 hover:text-neon-purple transition-colors"
          >
            Block #{formatNumber(nextHeight)}
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
            </svg>
          </Link>
        </div>

        {/* Block Header Card */}
        <GlowCard className="mb-8">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
            <div>
              <p className="text-gray-500 text-sm mb-1">Block</p>
              <h1 className="text-3xl font-bold gradient-text">
                #{formatNumber(block.height)}
              </h1>
            </div>
            <div className="flex items-center gap-2">
              {block.is_pos && (
                <span className="px-2 py-1 rounded text-xs font-medium bg-green-500/20 text-green-400 border border-green-500/30">
                  Proof of Stake
                </span>
              )}
            </div>
          </div>

          {/* Hash */}
          <div className="mb-4 pb-4 border-b border-white/5">
            <p className="text-xs text-gray-500 mb-1">Hash</p>
            <div className="flex items-center">
              <span className="font-mono text-sm text-gray-200 break-all">{block.hash}</span>
              <CopyButton text={block.hash} />
            </div>
          </div>

          {/* Previous Hash */}
          <div className="mb-6 pb-4 border-b border-white/5">
            <p className="text-xs text-gray-500 mb-1">Previous Hash</p>
            <Link
              to={`/block/${prevHeight}`}
              className="font-mono text-sm text-neon-blue hover:text-neon-purple transition-colors break-all"
            >
              {block.prev_hash}
            </Link>
          </div>

          {/* Details Grid */}
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-x-8">
            <DetailItem label="Timestamp">
              <span>{new Date(block.timestamp * 1000).toLocaleString()}</span>
              <span className="text-gray-500 text-xs ml-2">({timeAgo(block.timestamp)})</span>
            </DetailItem>
            <DetailItem label="Difficulty">
              {formatDifficulty(block.difficulty)}
            </DetailItem>
            <DetailItem label="Size">
              {formatBytes(block.size)}
            </DetailItem>
            <DetailItem label="Weight">
              {formatNumber(block.weight)}
            </DetailItem>
            <DetailItem label="Merkle Root">
              <span className="break-all">{block.merkle_root}</span>
            </DetailItem>
            <DetailItem label="Nonce">
              {formatNumber(block.nonce)}
            </DetailItem>
            <DetailItem label="Version">
              {block.version}
            </DetailItem>
            <DetailItem label="Chainwork">
              <span className="break-all">{block.chainwork}</span>
            </DetailItem>
            <DetailItem label="Net Supply Delta">
              {netSupplyDelta == null ? '—' : formatSignedNav(netSupplyDelta)}
            </DetailItem>
            <DetailItem label="Block Reward">
              {supply ? `${satsToCoin(supply.block_reward)} NAV` : '—'}
            </DetailItem>
            <DetailItem label="Fees Burned">
              {supply ? `${satsToCoin(supply.fees_burned)} NAV` : '—'}
            </DetailItem>
          </div>
        </GlowCard>

        {/* Transactions */}
        <div>
          <h2 className="text-xl font-semibold text-white mb-4">
            Transactions
            <span className="text-gray-500 text-base font-normal ml-2">
              ({txsRes ? formatNumber(txsRes.total) : block.tx_count})
            </span>
          </h2>

          {txsLoading ? (
            <Loader text="Loading transactions..." />
          ) : txsRes?.data && txsRes.data.length > 0 ? (
            <>
              <div className="space-y-2">
                {txsRes.data.map((tx: Transaction) => (
                  <GlowCard key={tx.txid} className="!p-4">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <Link
                          to={`/tx/${tx.txid}`}
                          className="font-mono text-sm text-neon-blue hover:text-neon-purple transition-colors truncate"
                        >
                          {truncateHash(tx.txid, 12)}
                        </Link>
                        <PrivacyBadge isBlsct={tx.is_blsct} />
                        {tx.is_coinbase && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-yellow-500/20 text-yellow-400 border border-yellow-500/30">
                            Coinbase
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-4 text-sm text-gray-400">
                        <span>{tx.input_count} in / {tx.output_count} out</span>
                        <span>{formatBytes(tx.size)}</span>
                      </div>
                    </div>
                  </GlowCard>
                ))}
              </div>

              <Pagination
                currentPage={txPage}
                totalPages={txTotalPages}
                onPageChange={handleTxPageChange}
              />
            </>
          ) : (
            <p className="text-gray-500 text-sm py-4">No transactions in this block.</p>
          )}
        </div>
      </div>
    </div>
  );
}
