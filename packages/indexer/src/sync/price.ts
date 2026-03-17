import type { PriceHistoryPoint } from "@navio-blocks/shared";
import type { Queries } from "../db/queries.js";

interface CoinGeckoResponse {
  nav?: {
    usd?: number;
    btc?: number;
    usd_24h_vol?: number;
    usd_market_cap?: number;
    usd_24h_change?: number;
  };
}

const COINGECKO_URL =
  "https://api.coingecko.com/api/v3/simple/price?ids=nav&vs_currencies=usd,btc&include_24hr_vol=true&include_market_cap=true&include_24hr_change=true&x_cg_demo_api_key=CG-efukmMdTeu85kraz8xyTE5GV";

export async function updatePrice(queries: Queries): Promise<void> {
  try {
    const res = await fetch(COINGECKO_URL);

    if (!res.ok) {
      console.error(`[price] CoinGecko HTTP error: ${res.status}`);
      return;
    }

    const data = (await res.json()) as CoinGeckoResponse;
    const nav = data.nav;

    if (!nav) {
      console.warn("[price] No navio data returned from CoinGecko "+ JSON.stringify(data));
      return;
    }

    const point: PriceHistoryPoint = {
      timestamp: Math.floor(Date.now() / 1000),
      price_usd: nav.usd ?? 0,
      price_btc: nav.btc ?? 0,
      volume_24h: nav.usd_24h_vol ?? 0,
      market_cap: nav.usd_market_cap ?? 0,
    };

    queries.insertPricePoint(point);
    console.log(
      `[price] Updated: $${point.price_usd.toFixed(4)} / ${point.price_btc.toFixed(8)} BTC`
    );
  } catch (err) {
    console.error("[price] Error fetching price:", err);
  }
}
