import type { PriceHistoryPoint } from "@navio-blocks/shared";
import type { Queries } from "../db/queries.js";

interface MexcTicker24h {
  symbol?: string;
  lastPrice?: string;
  quoteVolume?: string;
}

type MexcKline = [
  number, // open time (ms)
  string, // open
  string, // high
  string, // low
  string, // close
  string, // volume (base asset)
  number, // close time (ms)
  string, // quote asset volume
];

type KlineInterval = "60m" | "1d";

interface CandlePoint {
  timestamp: number; // seconds
  close: number;
  quoteVolume: number;
}

const MEXC_BASE_URL = "https://api.mexc.com/api/v3";
const NAV_SYMBOL = process.env.MEXC_NAV_SYMBOL ?? "NAVUSDT";
const BTC_SYMBOL = process.env.MEXC_BTC_SYMBOL ?? "BTCUSDT";

const DAY_SEC = 86400;
const BACKFILL_DAYS = 365;
const BACKFILL_HOURS_DAYS = 30;
const HISTORY_POINT_TARGET = 300;

let backfillAttempted = false;

function toNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value !== "string") return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function intervalMs(interval: KlineInterval): number {
  switch (interval) {
    case "60m":
      return 60 * 60 * 1000;
    case "1d":
      return DAY_SEC * 1000;
    default:
      return 60 * 60 * 1000;
  }
}

function shouldBackfill(queries: Queries): { hourly: boolean; daily: boolean } {
  const now = Math.floor(Date.now() / 1000);
  const count = queries.getPriceCount();
  const earliest = queries.getEarliestPriceTimestamp();
  const latest = queries.getLatestPriceTimestamp();

  const needHourly =
    count < HISTORY_POINT_TARGET ||
    latest == null ||
    latest < now - 6 * 3600;
  const needDaily =
    earliest == null ||
    earliest > now - BACKFILL_DAYS * DAY_SEC;

  return { hourly: needHourly, daily: needDaily };
}

async function fetchTicker24h(symbol: string): Promise<MexcTicker24h> {
  const url = `${MEXC_BASE_URL}/ticker/24hr?symbol=${encodeURIComponent(symbol)}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`MEXC HTTP ${res.status} for ticker ${symbol}`);
  }
  return (await res.json()) as MexcTicker24h;
}

async function fetchKlines(
  symbol: string,
  interval: KlineInterval,
  startSec: number,
  endSec: number
): Promise<CandlePoint[]> {
  const step = intervalMs(interval);
  const endMs = endSec * 1000;
  let nextStartMs = startSec * 1000;

  const points: CandlePoint[] = [];

  while (nextStartMs <= endMs) {
    const url = `${MEXC_BASE_URL}/klines?symbol=${encodeURIComponent(
      symbol
    )}&interval=${interval}&startTime=${nextStartMs}&endTime=${endMs}&limit=1000`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(
        `MEXC HTTP ${res.status} for klines ${symbol} ${interval}`
      );
    }

    const rows = (await res.json()) as unknown;
    if (!Array.isArray(rows) || rows.length === 0) break;

    const klines = rows as MexcKline[];
    for (const k of klines) {
      const openTimeMs = typeof k[0] === "number" ? k[0] : Number(k[0]);
      const ts = Math.floor(openTimeMs / 1000);
      const close = toNumber(k[4]);
      const quoteVol = toNumber(k[7]);
      if (!Number.isFinite(ts) || close <= 0) continue;
      points.push({
        timestamp: ts,
        close,
        quoteVolume: quoteVol,
      });
    }

    const last = klines[klines.length - 1];
    const lastOpenMs =
      typeof last[0] === "number" ? last[0] : Number(last[0]);
    const candidate = lastOpenMs + step;
    if (!Number.isFinite(candidate) || candidate <= nextStartMs) break;
    nextStartMs = candidate;
  }

  points.sort((a, b) => a.timestamp - b.timestamp);
  const deduped = new Map<number, CandlePoint>();
  for (const p of points) deduped.set(p.timestamp, p);
  return [...deduped.values()].sort((a, b) => a.timestamp - b.timestamp);
}

function storeDerivedPriceHistory(
  queries: Queries,
  navCandles: CandlePoint[],
  btcCandles: CandlePoint[]
): number {
  if (!navCandles.length || !btcCandles.length) return 0;

  let btcIndex = 0;
  let lastBtcUsd = 0;
  let inserted = 0;

  for (const nav of navCandles) {
    while (
      btcIndex < btcCandles.length &&
      btcCandles[btcIndex].timestamp <= nav.timestamp
    ) {
      lastBtcUsd = btcCandles[btcIndex].close;
      btcIndex++;
    }

    if (lastBtcUsd <= 0) continue;

    const point: PriceHistoryPoint = {
      timestamp: nav.timestamp,
      price_usd: nav.close,
      price_btc: nav.close / lastBtcUsd,
      volume_24h: nav.quoteVolume,
      market_cap: 0,
    };
    queries.insertPricePoint(point);
    inserted++;
  }

  return inserted;
}

async function backfillInterval(
  queries: Queries,
  interval: KlineInterval,
  fromSec: number,
  toSec: number
): Promise<number> {
  const [navCandles, btcCandles] = await Promise.all([
    fetchKlines(NAV_SYMBOL, interval, fromSec, toSec),
    fetchKlines(BTC_SYMBOL, interval, fromSec, toSec),
  ]);
  return storeDerivedPriceHistory(queries, navCandles, btcCandles);
}

async function backfillPriceHistory(queries: Queries): Promise<void> {
  const { hourly, daily } = shouldBackfill(queries);
  if (!hourly && !daily) return;

  const now = Math.floor(Date.now() / 1000);
  let inserted = 0;

  try {
    if (daily) {
      inserted += await backfillInterval(
        queries,
        "1d",
        now - BACKFILL_DAYS * DAY_SEC,
        now
      );
    }
    if (hourly) {
      inserted += await backfillInterval(
        queries,
        "60m",
        now - BACKFILL_HOURS_DAYS * DAY_SEC,
        now
      );
    }
  } catch (err) {
    console.error("[price] Error during MEXC history backfill:", err);
    return;
  }

  if (inserted > 0) {
    console.log(`[price] Backfilled ${inserted} historical points from MEXC`);
  }
}

export async function updatePrice(queries: Queries): Promise<void> {
  try {
    if (!backfillAttempted) {
      backfillAttempted = true;
      await backfillPriceHistory(queries);
    }

    const [navTicker, btcTicker] = await Promise.all([
      fetchTicker24h(NAV_SYMBOL),
      fetchTicker24h(BTC_SYMBOL),
    ]);

    const navUsd = toNumber(navTicker.lastPrice);
    const btcUsd = toNumber(btcTicker.lastPrice);
    if (navUsd <= 0 || btcUsd <= 0) {
      console.warn(
        `[price] Invalid ticker values from MEXC nav=${navTicker.lastPrice} btc=${btcTicker.lastPrice}`
      );
      return;
    }

    const point: PriceHistoryPoint = {
      timestamp: Math.floor(Date.now() / 1000),
      price_usd: navUsd,
      price_btc: navUsd / btcUsd,
      volume_24h: toNumber(navTicker.quoteVolume),
      market_cap: 0,
    };

    queries.insertPricePoint(point);
    console.log(
      `[price] Updated (MEXC ${NAV_SYMBOL}): $${point.price_usd.toFixed(
        4
      )} / ${point.price_btc.toFixed(8)} BTC`
    );
  } catch (err) {
    console.error("[price] Error fetching MEXC price:", err);
  }
}
