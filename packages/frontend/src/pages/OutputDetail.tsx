import { useParams, Link } from 'react-router-dom';
import { api } from '../api';
import { useApi } from '../hooks/useApi';
import { satsToCoin, truncateHash, formatNumber, isRealToken, splitTokenId } from '../utils';
import GlowCard from '../components/GlowCard';
import OutputTypeBadge from '../components/OutputTypeBadge';
import PrivacyBadge from '../components/PrivacyBadge';
import CopyButton from '../components/CopyButton';
import Loader from '../components/Loader';
import type { OutputDetail as OutputDetailType } from '@navio-blocks/shared';

export default function OutputDetail() {
  const { hash } = useParams<{ hash: string }>();
  const { data: output, loading, error } = useApi<OutputDetailType>(
    () => api.getOutput(hash!),
    [hash],
  );

  if (loading) return <Loader text="Loading output..." />;

  if (error || !output) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <div className="text-6xl mb-4">404</div>
        <h2 className="text-xl font-semibold text-white mb-2">Output not found</h2>
        <p className="text-white/40 font-mono text-sm mb-6">
          {hash ? truncateHash(hash, 16) : 'Unknown hash'}
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

  const isSpent = Boolean(output.spent);
  const hasToken = isRealToken(output.token_id);
  const tokenParts = splitTokenId(output.token_id);
  const tokenBase = tokenParts?.base ?? '';
  const tokenLinkBase = tokenBase || (output.token_id ? output.token_id.replace(/#.*$/, '') : '');
  const nftIndex = tokenParts?.nftIndex;
  const isNft = hasToken && Boolean(nftIndex);
  const spkDimmed = output.spk_hex === '51'; // OP_TRUE
  const predicateArgs =
    output.predicate_args && typeof output.predicate_args === 'object'
      ? (output.predicate_args as Record<string, unknown>)
      : undefined;
  const mintAmount = predicateArgs?.amount;

  return (
    <div className="space-y-6">
      <GlowCard hover={false}>
        <div className="space-y-5">
          {/* Hash */}
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-white/40 mb-1.5">Output Hash</p>
            <div className="flex items-center gap-2">
              <span className="font-mono text-lg text-white break-all leading-relaxed">{output.output_hash}</span>
              <CopyButton text={output.output_hash} />
            </div>
          </div>

          {/* Badges */}
          <div className="flex flex-wrap items-center gap-2">
            {output.output_type && <OutputTypeBadge type={output.output_type} />}
            <PrivacyBadge isBlsct={output.is_blsct} />
            {hasToken && (
              <span className={`inline-block rounded px-2 py-0.5 text-xs font-mono font-medium border ${isNft ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30' : 'bg-teal-500/20 text-teal-300 border-teal-500/30'}`}>
                {isNft ? 'NFT' : 'Token'}
              </span>
            )}
          </div>

          {/* Metadata grid */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {output.value_sat != null && output.value_sat > 0 && (
              <div>
                <p className="text-[10px] uppercase tracking-wider text-white/30 mb-0.5">Value</p>
                <span className="font-mono text-sm text-white">{satsToCoin(output.value_sat)} NAV</span>
              </div>
            )}
            {output.address && (
              <div>
                <p className="text-[10px] uppercase tracking-wider text-white/30 mb-0.5">Address</p>
                <span className="font-mono text-sm text-white break-all">{output.address}</span>
              </div>
            )}
            <div>
              <p className="text-[10px] uppercase tracking-wider text-white/30 mb-0.5">Block</p>
              <Link
                to={`/block/${output.block_height}`}
                className="font-mono text-sm text-neon-blue hover:text-neon-pink transition-colors"
              >
                {formatNumber(output.block_height)}
              </Link>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-white/30 mb-0.5">Parent Transaction</p>
              <Link
                to={`/tx/${output.txid}`}
                className="font-mono text-sm text-neon-blue hover:text-neon-pink transition-colors"
                title={output.txid}
              >
                {truncateHash(output.txid, 10)}
              </Link>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-white/30 mb-0.5">Output Index</p>
              <span className="font-mono text-sm text-white">{output.n}</span>
            </div>
          </div>

          {/* Spent status */}
          <div className="flex items-center gap-2">
            <span
              className={`inline-block rounded px-2 py-0.5 text-xs font-mono font-medium border ${isSpent
                ? 'bg-rose-500/20 text-rose-200 border-rose-500/30'
                : 'bg-emerald-500/20 text-emerald-200 border-emerald-500/30'
              }`}
            >
              {isSpent ? 'Spent' : 'Unspent'}
            </span>
            {isSpent && output.spending_txid && (
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] uppercase tracking-wider text-white/30">By</span>
                <Link
                  to={`/tx/${output.spending_txid}`}
                  className="font-mono text-sm text-neon-blue hover:text-neon-purple truncate"
                  title={output.spending_txid}
                >
                  {truncateHash(output.spending_txid, 10)}
                </Link>
                <CopyButton text={output.spending_txid} />
              </div>
            )}
          </div>
        </div>
      </GlowCard>

      {/* Token section */}
      {hasToken && (
        <GlowCard hover={false}>
          <h3 className="text-sm font-semibold uppercase tracking-wider text-white/60 mb-3">
            Token Info
          </h3>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-[10px] uppercase tracking-wider text-white/30">Token ID</span>
              {tokenLinkBase ? (
                <Link
                  to={`/token/${tokenLinkBase}`}
                  className="font-mono text-sm text-neon-blue hover:text-neon-pink transition-colors break-all"
                >
                  {tokenLinkBase}
                </Link>
              ) : (
                <span className="font-mono text-sm text-white break-all">{output.token_id}</span>
              )}
              {tokenLinkBase && <CopyButton text={tokenLinkBase} />}
            </div>
            {isNft && nftIndex && (
              <div className="flex items-center gap-2">
                <span className="text-[10px] uppercase tracking-wider text-white/30">NFT Sub-ID</span>
                <Link
                  to={`/nft/${tokenLinkBase}/${nftIndex}`}
                  className="font-mono text-sm text-neon-blue hover:text-neon-pink transition-colors"
                >
                  {nftIndex}
                </Link>
              </div>
            )}
            {mintAmount != null && (
              <div className="flex items-center gap-2">
                <span className="text-[10px] uppercase tracking-wider text-white/30">Mint Amount</span>
                <span className="font-mono text-sm text-white">{String(mintAmount)}</span>
              </div>
            )}
          </div>
        </GlowCard>
      )}

      {/* Predicate */}
      {output.predicate && (
        <GlowCard hover={false}>
          <h3 className="text-sm font-semibold uppercase tracking-wider text-white/60 mb-3">
            Predicate
          </h3>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-[10px] uppercase tracking-wider text-white/30">Type</span>
              <span className="font-mono text-sm text-white">{output.predicate}</span>
            </div>
            {output.predicate_hex && (
              <div className="flex items-center gap-2">
                <span className="text-[10px] uppercase tracking-wider text-white/30">Hex</span>
                <span className="font-mono text-xs text-white/70 break-all">{output.predicate_hex}</span>
              </div>
            )}
            {predicateArgs && Object.keys(predicateArgs).length > 0 && (
              <div className="space-y-1">
                <p className="text-[10px] uppercase tracking-wider text-white/30">Arguments</p>
                {Object.entries(predicateArgs).map(([key, value]) => (
                  <div key={key} className="flex items-start gap-2">
                    <span className="font-mono text-xs text-white/40 min-w-[96px]">{key}</span>
                    <span className="font-mono text-xs text-white/70 break-all">
                      {typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </GlowCard>
      )}

      {/* BLSCT fields */}
      {output.is_blsct && (
        <GlowCard hover={false}>
          <h3 className="text-sm font-semibold uppercase tracking-wider text-white/60 mb-3">
            BLSCT Fields
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {output.spending_key && (
              <div>
                <p className="text-[10px] uppercase tracking-wider text-white/30 mb-0.5">Spending Key</p>
                <span className="font-mono text-xs text-white/70 break-all">{output.spending_key}</span>
              </div>
            )}
            {output.ephemeral_key && (
              <div>
                <p className="text-[10px] uppercase tracking-wider text-white/30 mb-0.5">Ephemeral Key</p>
                <span className="font-mono text-xs text-white/70 break-all">{output.ephemeral_key}</span>
              </div>
            )}
            {output.blinding_key && (
              <div>
                <p className="text-[10px] uppercase tracking-wider text-white/30 mb-0.5">Blinding Key</p>
                <span className="font-mono text-xs text-white/70 break-all">{output.blinding_key}</span>
              </div>
            )}
            {output.view_tag && (
              <div>
                <p className="text-[10px] uppercase tracking-wider text-white/30 mb-0.5">View Tag</p>
                <span className="font-mono text-xs text-white/70">{output.view_tag}</span>
              </div>
            )}
          </div>
        </GlowCard>
      )}

      {/* ScriptPubKey */}
      {(output.spk_type || output.spk_hex) && (
        <GlowCard hover={false}>
          <h3 className="text-sm font-semibold uppercase tracking-wider text-white/60 mb-3">
            ScriptPubKey
          </h3>
          {output.spk_type && (
            <div className="mb-2">
              <span className="text-[10px] uppercase tracking-wider text-white/30 mr-2">Type</span>
              <span className="font-mono text-sm text-white">{output.spk_type}</span>
            </div>
          )}
          {output.spk_hex && (
            <div>
              <span className="text-[10px] uppercase tracking-wider text-white/30 mr-2">Hex</span>
              <span className={`font-mono text-xs break-all ${spkDimmed ? 'text-white/25' : 'text-white/70'}`}>
                {output.spk_hex}
              </span>
            </div>
          )}
        </GlowCard>
      )}
    </div>
  );
}
