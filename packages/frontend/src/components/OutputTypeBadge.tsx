import type { OutputType } from '@navio-blocks/shared';

const TYPE_STYLES: Record<OutputType, { bg: string; text: string; border: string; label: string }> = {
  transfer:       { bg: 'bg-blue-500/20',    text: 'text-blue-300',    border: 'border-blue-500/30',    label: 'Transfer' },
  fee:          { bg: 'bg-amber-500/20',   text: 'text-amber-300',   border: 'border-amber-500/30',   label: 'Fee' },
  coinbase:     { bg: 'bg-gradient-to-r from-neon-pink/20 to-neon-purple/20', text: 'text-neon-pink', border: 'border-neon-pink/30', label: 'Coinbase' },
  stake:        { bg: 'bg-green-500/20',   text: 'text-green-300',   border: 'border-green-500/30',   label: 'Stake' },
  htlc:         { bg: 'bg-orange-500/20',  text: 'text-orange-300',  border: 'border-orange-500/30',  label: 'HTLC' },
  token_create: { bg: 'bg-teal-500/20',    text: 'text-teal-300',    border: 'border-teal-500/30',    label: 'Token Create' },
  token_mint:   { bg: 'bg-teal-500/20',    text: 'text-teal-300',    border: 'border-teal-500/30',    label: 'Token Mint' },
  nft_create:   { bg: 'bg-indigo-500/20',  text: 'text-indigo-300',  border: 'border-indigo-500/30',  label: 'NFT Create' },
  nft_mint:     { bg: 'bg-indigo-500/20',  text: 'text-indigo-300',  border: 'border-indigo-500/30',  label: 'NFT Mint' },
  unknown:      { bg: 'bg-gray-600/20',    text: 'text-gray-500',    border: 'border-gray-600/30',    label: 'Unknown' },
};

// Bar chart colors
export const TYPE_BAR_COLORS: Record<OutputType, string> = {
  transfer: '#3b82f6',
  fee: '#f59e0b',
  coinbase: '#ec4899',
  stake: '#22c55e',
  htlc: '#f97316',
  token_create: '#14b8a6',
  token_mint: '#14b8a6',
  nft_create: '#6366f1',
  nft_mint: '#6366f1',
  unknown: '#4b5563',
};

interface OutputTypeBadgeProps {
  type: OutputType;
  className?: string;
}

export default function OutputTypeBadge({ type, className = '' }: OutputTypeBadgeProps) {
  const style = TYPE_STYLES[type] ?? TYPE_STYLES.unknown;
  return (
    <span
      className={`inline-block rounded px-2 py-0.5 text-xs font-mono font-medium border ${style.bg} ${style.text} ${style.border} ${className}`}
    >
      {style.label}
    </span>
  );
}
