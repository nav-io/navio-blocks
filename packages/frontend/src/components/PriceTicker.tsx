import { useApi } from '../hooks/useApi';
import { api } from '../api';
import { formatUSD, formatPercent } from '../utils';

export function PriceTicker() {
  const { data } = useApi(() => api.getPrice(), []);

  if (!data) return null;

  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-white/45 uppercase tracking-wide text-[11px]">NAV</span>
      <span className="text-white font-semibold">{formatUSD(data.price_usd)}</span>
      <span
        className={`font-medium ${
          data.change_24h_pct >= 0 ? 'text-emerald-300' : 'text-rose-300'
        }`}
      >
        {formatPercent(data.change_24h_pct)}
      </span>
    </div>
  );
}
