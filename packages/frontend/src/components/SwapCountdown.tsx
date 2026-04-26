import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useApi } from '../hooks/useApi';
import { formatNumber } from '../utils';
import GlowCard from './GlowCard';

interface CountdownParts {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

function partsFromSeconds(total: number): CountdownParts {
  const safe = Math.max(0, Math.floor(total));
  return {
    days: Math.floor(safe / 86400),
    hours: Math.floor((safe % 86400) / 3600),
    minutes: Math.floor((safe % 3600) / 60),
    seconds: safe % 60,
  };
}

function formatActivationDate(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000);
  return d.toLocaleString(undefined, {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function pad(n: number, width = 2): string {
  return n.toString().padStart(width, '0');
}

function DigitBlock({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex flex-col items-center gap-1 min-w-[64px]">
      <div className="relative">
        <div
          className="font-mono text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight gradient-text leading-none tabular-nums"
          aria-label={`${value} ${label}`}
        >
          {pad(value)}
        </div>
      </div>
      <span className="text-[10px] uppercase tracking-[0.18em] text-white/45">
        {label}
      </span>
    </div>
  );
}

function Separator() {
  return (
    <span className="font-mono text-3xl sm:text-4xl md:text-5xl font-bold text-white/25 leading-none -translate-y-2">
      :
    </span>
  );
}

export default function SwapCountdown() {
  const { data: status, error, refetch } = useApi(() => api.getSwapStatus(), []);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    const tick = () => setNow(Math.floor(Date.now() / 1000));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, []);

  // Re-anchor to the server-side electrum reading periodically so the local
  // ticker doesn't drift away from the actual Navcoin tip.
  useEffect(() => {
    const id = window.setInterval(refetch, 30_000);
    return () => window.clearInterval(id);
  }, [refetch]);

  const remainingSeconds = useMemo(() => {
    if (!status) return null;
    if (status.activated) return 0;
    if (status.eta_timestamp == null) return null;
    return Math.max(0, status.eta_timestamp - now);
  }, [status, now]);

  const parts = useMemo(
    () => partsFromSeconds(remainingSeconds ?? 0),
    [remainingSeconds],
  );

  const progressPct = useMemo(() => {
    if (!status || status.current_height == null) return null;
    if (status.current_height >= status.target_height) return 100;
    // Anchor the bar to a reasonable lookback (~2.5M blocks ≈ couple of years
    // at 30s spacing) so we always show meaningful, non-flatline progress.
    const window = 2_500_000;
    const start = status.target_height - window;
    const traveled = status.current_height - start;
    return Math.max(0, Math.min(100, (traveled / window) * 100));
  }, [status]);

  const targetText = status
    ? formatNumber(status.target_height)
    : '10,500,000';

  return (
    <GlowCard hover={false} className="relative overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-60"
        style={{
          background:
            'radial-gradient(800px 220px at 10% 0%, rgba(79, 179, 255, 0.18), transparent 60%), radial-gradient(700px 220px at 90% 100%, rgba(242, 93, 156, 0.14), transparent 65%)',
        }}
      />
      <div className="relative">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between mb-5">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/35 bg-emerald-400/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-200">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-300 opacity-70" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-300" />
                </span>
                Live
              </span>
              <span className="text-[10px] uppercase tracking-[0.18em] text-white/40">
                Navcoin → Navio swap
              </span>
            </div>
            <h2 className="text-xl sm:text-2xl font-bold gradient-text">
              Swap activates at Navcoin block #{targetText}
            </h2>
            <p className="text-xs text-white/45 mt-1">
              ETA estimated from current Navcoin tip and {status?.avg_block_seconds ?? 30}s target spacing.
            </p>
          </div>
          {status?.eta_timestamp != null && !status.activated && (
            <div className="text-left sm:text-right">
              <p className="text-[10px] uppercase tracking-[0.18em] text-white/40">
                Estimated activation
              </p>
              <p className="text-sm font-mono text-white/85">
                {formatActivationDate(status.eta_timestamp)}
              </p>
            </div>
          )}
        </div>

        {status?.activated ? (
          <div className="rounded-xl border border-emerald-400/40 bg-emerald-400/5 p-5 text-center">
            <p className="text-[10px] uppercase tracking-[0.22em] text-emerald-200 mb-1">
              Activated
            </p>
            <p className="text-2xl font-bold gradient-text">
              The swap is live.
            </p>
            <p className="text-xs text-white/55 mt-2">
              Navcoin tip {formatNumber(status.current_height ?? 0)} ≥ target {targetText}.
            </p>
          </div>
        ) : remainingSeconds == null ? (
          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5 text-center">
            <p className="text-sm text-white/55">
              {error || status?.error
                ? `Couldn't reach the Navcoin Electrum server${status?.electrum_host ? ` (${status.electrum_host})` : ''}. Retrying…`
                : 'Loading countdown from Navcoin Electrum…'}
            </p>
          </div>
        ) : (
          <div className="flex items-end justify-center gap-3 sm:gap-5 py-2">
            <DigitBlock value={parts.days} label="Days" />
            <Separator />
            <DigitBlock value={parts.hours} label="Hours" />
            <Separator />
            <DigitBlock value={parts.minutes} label="Minutes" />
            <Separator />
            <DigitBlock value={parts.seconds} label="Seconds" />
          </div>
        )}

        <div className="mt-6">
          <div className="flex items-center justify-between text-[11px] font-mono text-white/55 mb-1.5">
            <span>
              Navcoin tip:{' '}
              <span className="text-white/90">
                {status?.current_height != null
                  ? `#${formatNumber(status.current_height)}`
                  : '—'}
              </span>
            </span>
            <span>
              {status?.blocks_remaining != null && !status.activated
                ? `${formatNumber(status.blocks_remaining)} blocks to go`
                : status?.activated
                  ? 'Target reached'
                  : ''}
            </span>
            <span>
              Target:{' '}
              <span className="text-white/90">#{targetText}</span>
            </span>
          </div>
          <div className="h-1.5 w-full rounded-full overflow-hidden border border-white/10 bg-white/[0.04]">
            <div
              className="h-full rounded-full transition-[width] duration-700 ease-out"
              style={{
                width: `${progressPct ?? 0}%`,
                background:
                  'linear-gradient(90deg, #4fb3ff 0%, #7c7eff 50%, #f25d9c 100%)',
                boxShadow: '0 0 14px rgba(124, 126, 255, 0.45)',
              }}
            />
          </div>
          {status?.electrum_host && (
            <p className="text-[10px] text-white/30 mt-2">
              Source: electrum {status.electrum_host}
              {status.error ? ` · ${status.error}` : ''}
            </p>
          )}
        </div>
      </div>
    </GlowCard>
  );
}
