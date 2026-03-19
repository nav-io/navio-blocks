import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api';
import { useApi } from '../hooks/useApi';
import { satsToCoin, truncateHash, formatNumber, formatBytes, isRealToken } from '../utils';
import GlowCard from '../components/GlowCard';
import PrivacyBadge from '../components/PrivacyBadge';
import OutputTypeBadge from '../components/OutputTypeBadge';
import CopyButton from '../components/CopyButton';
import Loader from '../components/Loader';
import type { TransactionDetail as TxDetailType, Input, Output, BlockSupply } from '@navio-blocks/shared';

function formatSignedNav(sats: number): string {
  const sign = sats > 0 ? '+' : sats < 0 ? '-' : '';
  return `${sign}${satsToCoin(Math.abs(sats))} NAV`;
}

function parseTxFeeSats(naviodTx?: Record<string, unknown> | null): number | null {
  const fee = naviodTx?.fee;
  if (typeof fee !== 'number' || !Number.isFinite(fee)) return null;
  return Math.round(fee * 1e8);
}

function InputRow({ input, index }: { input: Input; index: number }) {
  return (
    <div className="flex items-start gap-3 py-3 border-b border-white/5 last:border-b-0">
      <span className="text-xs font-mono text-white/30 mt-0.5 w-6 text-right shrink-0">
        {index}
      </span>
      {input.is_coinbase ? (
        <div className="flex items-center gap-2">
          <span className="inline-block rounded bg-gradient-to-r from-neon-pink to-neon-purple px-2 py-0.5 text-xs font-mono font-medium text-white">
            Coinbase
          </span>
          <span className="text-xs text-white/40 font-mono">Newly minted coins</span>
        </div>
      ) : (
        <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
          <span className="text-[10px] uppercase tracking-wider text-white/30 shrink-0">Outpoint</span>
          {input.prev_out ? (
            <>
              <Link
                to={`/tx/${input.prev_out}`}
                className="font-mono text-sm text-neon-blue hover:text-neon-purple truncate"
                title={input.prev_out}
              >
                {truncateHash(input.prev_out, 12)}
              </Link>
              <CopyButton text={input.prev_out} />
              {input.output_type && <OutputTypeBadge type={input.output_type} />}
            </>
          ) : (
            <span className="font-mono text-sm text-white/40 italic">Unknown previous output</span>
          )}
        </div>
      )}
    </div>
  );
}

function OutputRow({ output, index }: { output: Output; index: number }) {
  const isSpent = Boolean(output.spent);
  const isFeeType = output.output_type === 'fee';
  const spkDimmed = output.spk_hex === '51';

  return (
    <div className="py-3 border-b border-white/5 last:border-b-0">
      <div className="flex items-start gap-3">
        <span className="text-xs font-mono text-white/30 mt-0.5 w-6 text-right shrink-0">
          {index}
        </span>
        <div className="flex-1 min-w-0">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 min-w-0 flex-wrap">
              <span className="text-[10px] uppercase tracking-wider text-white/30 shrink-0">Hash</span>
              {output.output_hash ? (
                <>
                  <Link
                    to={`/output/${output.output_hash}`}
                    className="font-mono text-sm text-neon-blue hover:text-neon-purple truncate"
                    title={output.output_hash}
                  >
                    {truncateHash(output.output_hash, 12)}
                  </Link>
                  <CopyButton text={output.output_hash} />
                </>
              ) : (
                <span className="font-mono text-sm text-white/40 italic">No output hash</span>
              )}
              {output.output_type && <OutputTypeBadge type={output.output_type} />}
              {output.is_blsct && <PrivacyBadge isBlsct />}
              {isRealToken(output.token_id) && (
                <span className={`inline-block rounded px-2 py-0.5 text-xs font-mono font-medium border ${
                  output.token_id!.includes('#')
                    ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30'
                    : 'bg-teal-500/20 text-teal-300 border-teal-500/30'
                }`}>
                  {output.token_id!.includes('#') ? 'NFT' : 'Token'}
                </span>
              )}
            </div>

            {output.value_sat != null && output.value_sat > 0 && (
              <div className="font-mono text-sm text-white">
                {satsToCoin(output.value_sat)} NAV
              </div>
            )}

            {isRealToken(output.token_id) && (
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] uppercase tracking-wider text-white/30 shrink-0">Token</span>
                <span className="font-mono text-xs text-white/60">{truncateHash(output.token_id!, 10)}</span>
              </div>
            )}

            {output.spk_hex && (
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] uppercase tracking-wider text-white/30 shrink-0">Script</span>
                <span className={`font-mono text-xs truncate ${spkDimmed ? 'text-white/20' : 'text-white/50'}`} title={output.spk_hex}>
                  {output.spk_type ?? ''}{output.spk_type && output.spk_hex ? ' · ' : ''}{truncateHash(output.spk_hex, 8)}
                </span>
              </div>
            )}

            {!isFeeType && (
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className={`inline-block rounded px-2 py-0.5 text-xs font-mono font-medium border ${isSpent
                      ? 'bg-rose-500/20 text-rose-200 border-rose-500/30'
                      : 'bg-emerald-500/20 text-emerald-200 border-emerald-500/30'
                    }`}
                >
                  {isSpent ? 'Spent' : 'Unspent'}
                </span>
                {isSpent && output.spending_txid ? (
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="text-[10px] uppercase tracking-wider text-white/30 shrink-0">By</span>
                    <Link
                      to={`/tx/${output.spending_txid}`}
                      className="font-mono text-sm text-neon-blue hover:text-neon-purple truncate"
                      title={output.spending_txid}
                    >
                      {truncateHash(output.spending_txid, 12)}
                    </Link>
                    <CopyButton text={output.spending_txid} />
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function TxDetail() {
  const [showRawJson, setShowRawJson] = useState(false);
  const { txid } = useParams<{ txid: string }>();
  const { data: tx, loading, error } = useApi<TxDetailType>(
    () => api.getTx(txid!),
    [txid],
  );
  const { data: supply } = useApi<BlockSupply | null>(
    () => (tx ? api.getSupplyBlock(tx.block_height) : Promise.resolve(null)),
    [tx?.block_height],
  );

  if (loading) {
    return <Loader text="Loading transaction..." />;
  }

  if (error || !tx) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <div className="text-6xl mb-4">404</div>
        <h2 className="text-xl font-semibold text-white mb-2">Transaction not found</h2>
        <p className="text-white/40 font-mono text-sm mb-6">
          {txid ? truncateHash(txid, 16) : 'Unknown TXID'}
        </p>
        <Link
          to="/"
          className="px-4 py-2 rounded-lg bg-gradient-to-r from-neon-pink to-neon-purple text-white text-sm font-medium hover:opacity-90 transition-opacity"
        >
          Back to Explorer
        </Link>
      </div>
    );
  }

  const txFeeSats = parseTxFeeSats(tx.naviod_tx);
  const txSupplyDeltaSats = tx.is_coinbase
    ? (supply ? supply.block_reward : null)
    : txFeeSats != null
      ? -txFeeSats
      : null;

  return (
    <div className="space-y-6">
      {/* Header card with metadata */}
      <GlowCard hover={false}>
        <div className="space-y-5">
          {/* TXID */}
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-white/40 mb-1.5">
              Transaction
            </p>
            <div className="flex items-center gap-2">
              <span className="font-mono text-lg text-white break-all leading-relaxed">
                {tx.txid}
              </span>
              <CopyButton text={tx.txid} />
            </div>
          </div>

          {/* Privacy badge */}
          <div>
            <PrivacyBadge isBlsct={tx.is_blsct} />
            {tx.is_coinbase && (
              <span className="ml-2 inline-block rounded-full bg-neon-blue/20 px-2.5 py-0.5 text-xs font-mono font-medium text-neon-blue">
                Coinbase
              </span>
            )}
          </div>

          {/* Metadata grid */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-white/30 mb-0.5">
                Block Height
              </p>
              <Link
                to={`/block/${tx.block_height}`}
                className="font-mono text-sm text-neon-blue hover:text-neon-pink transition-colors"
              >
                {formatNumber(tx.block_height)}
              </Link>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-white/30 mb-0.5">
                Confirmations
              </p>
              <span className="font-mono text-sm text-white">
                {formatNumber(tx.block_height)}
              </span>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-white/30 mb-0.5">Size</p>
              <span className="font-mono text-sm text-white">{formatBytes(tx.size)}</span>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-white/30 mb-0.5">VSize</p>
              <span className="font-mono text-sm text-white">{formatNumber(tx.vsize)} vB</span>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-white/30 mb-0.5">Version</p>
              <span className="font-mono text-sm text-white">{tx.version}</span>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-white/30 mb-0.5">Locktime</p>
              <span className="font-mono text-sm text-white">{formatNumber(tx.locktime)}</span>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-white/30 mb-0.5">Supply Delta</p>
              <span className="font-mono text-sm text-white">
                {txSupplyDeltaSats == null ? '—' : formatSignedNav(txSupplyDeltaSats)}
              </span>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-white/30 mb-0.5">Tx Fee</p>
              <span className="font-mono text-sm text-white">
                {txFeeSats == null ? '—' : `${satsToCoin(txFeeSats)} NAV`}
              </span>
            </div>
          </div>
        </div>
      </GlowCard>

      {/* Inputs and Outputs */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr,auto,1fr] gap-4 items-start">
        {/* Inputs */}
        <GlowCard hover={false}>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-white/60">
              Inputs
            </h3>
            <span className="text-xs font-mono text-white/30">
              {tx.inputs.length} input{tx.inputs.length !== 1 ? 's' : ''}
            </span>
          </div>
          <div>
            {tx.inputs.map((input, i) => (
              <InputRow key={`${input.prev_out}-${i}`} input={input} index={i} />
            ))}
          </div>
        </GlowCard>

        {/* Arrow */}
        <div className="hidden lg:flex items-center justify-center self-center">
          <div className="w-12 h-12 rounded-full bg-gradient-to-r from-neon-pink to-neon-purple flex items-center justify-center shadow-glow-pink">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              className="w-5 h-5 text-white"
            >
              <path
                fillRule="evenodd"
                d="M3 10a.75.75 0 01.75-.75h10.638L10.23 5.29a.75.75 0 111.04-1.08l5.5 5.25a.75.75 0 010 1.08l-5.5 5.25a.75.75 0 11-1.04-1.08l4.158-3.96H3.75A.75.75 0 013 10z"
                clipRule="evenodd"
              />
            </svg>
          </div>
        </div>

        {/* Mobile arrow */}
        <div className="flex lg:hidden items-center justify-center py-2">
          <div className="w-10 h-10 rounded-full bg-gradient-to-r from-neon-pink to-neon-purple flex items-center justify-center shadow-glow-pink">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              className="w-4 h-4 text-white rotate-90"
            >
              <path
                fillRule="evenodd"
                d="M3 10a.75.75 0 01.75-.75h10.638L10.23 5.29a.75.75 0 111.04-1.08l5.5 5.25a.75.75 0 010 1.08l-5.5 5.25a.75.75 0 11-1.04-1.08l4.158-3.96H3.75A.75.75 0 013 10z"
                clipRule="evenodd"
              />
            </svg>
          </div>
        </div>

        {/* Outputs */}
        <GlowCard hover={false}>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-white/60">
              Outputs
            </h3>
            <span className="text-xs font-mono text-white/30">
              {tx.outputs.length} output{tx.outputs.length !== 1 ? 's' : ''}
            </span>
          </div>
          <div>
            {tx.outputs.map((output, i) => (
              <OutputRow key={output.output_hash || `${output.txid}-${i}`} output={output} index={i} />
            ))}
          </div>
        </GlowCard>
      </div>

      <GlowCard hover={false}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-white/60">
            Raw Naviod JSON
          </h3>
          <button
            type="button"
            onClick={() => setShowRawJson((v) => !v)}
            className="text-xs font-mono rounded border border-white/15 px-3 py-1.5 text-white/80 hover:text-white hover:border-white/30 transition-colors"
          >
            {showRawJson ? 'Hide' : 'Show'}
          </button>
        </div>

        {showRawJson ? (
          tx.naviod_tx ? (
            <pre className="max-h-[520px] overflow-auto rounded-lg border border-white/10 bg-black/30 p-3 text-xs text-white/80 font-mono whitespace-pre-wrap break-words">
              {JSON.stringify(tx.naviod_tx, null, 2)}
            </pre>
          ) : (
            <p className="text-sm text-white/50">Raw naviod JSON is not available for this tx in the indexed database yet.</p>
          )
        ) : null}
      </GlowCard>
    </div>
  );
}
