import {
  createPublicClient,
  http,
  parseAbi,
  getAddress,
  zeroAddress,
  type Address,
} from "viem";
import { bsc } from "viem/chains";
import type { PriceHistoryPoint } from "@navio-blocks/shared";
import type { Queries } from "../db/queries.js";

// NAV is priced from its on-chain PancakeSwap (BSC) market via the wrapped
// token wNAV. We read pair reserves directly (no third-party price API):
//   navUsd = (wNAV/WBNB) * (WBNB/USDT)
//   navBtc = navUsd / (BTCB/USDT)
// Pairs are resolved through the PancakeSwap v2 factory and cached.

const BSC_RPC =
  process.env.BSC_HTTP_URL?.trim() || "https://bsc-dataseed.binance.org";

const PANCAKE_FACTORY: Address = getAddress(
  "0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73"
);

// BSC token addresses with their decimals. wNAV uses 8 decimals (like native
// NAV); WBNB/USDT/BTCB use 18.
const WNAV = getAddress("0xBFEf6cCFC830D3BaCA4F6766a0d4AaA242Ca9F3D");
const WBNB = getAddress("0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c");
const USDT = getAddress("0x55d398326f99059fF775485246999027B3197955");
const BTCB = getAddress("0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c");
const WNAV_DECIMALS = 8;
const EVM_DECIMALS = 18;

const FACTORY_ABI = parseAbi([
  "function getPair(address tokenA, address tokenB) view returns (address pair)",
]);
const PAIR_ABI = parseAbi([
  "function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
  "function token0() view returns (address)",
]);

const client = createPublicClient({ chain: bsc, transport: http(BSC_RPC) });

const pairCache = new Map<string, Address>();

async function resolvePair(a: Address, b: Address): Promise<Address> {
  const key = `${a}/${b}`;
  const cached = pairCache.get(key);
  if (cached) return cached;
  const pair = (await client.readContract({
    address: PANCAKE_FACTORY,
    abi: FACTORY_ABI,
    functionName: "getPair",
    args: [a, b],
  })) as Address;
  if (pair === zeroAddress) {
    throw new Error(`No PancakeSwap pair for ${a}/${b}`);
  }
  pairCache.set(key, pair);
  return pair;
}

/** Price of `base` quoted in `quote`, decimals-adjusted, from their pair reserves. */
async function pairPrice(
  base: Address,
  baseDecimals: number,
  quote: Address,
  quoteDecimals: number
): Promise<number> {
  const pair = await resolvePair(base, quote);
  const [reserves, token0] = await Promise.all([
    client.readContract({
      address: pair,
      abi: PAIR_ABI,
      functionName: "getReserves",
    }) as Promise<readonly [bigint, bigint, number]>,
    client.readContract({
      address: pair,
      abi: PAIR_ABI,
      functionName: "token0",
    }) as Promise<Address>,
  ]);

  const baseIsToken0 = token0.toLowerCase() === base.toLowerCase();
  const reserveBase = baseIsToken0 ? reserves[0] : reserves[1];
  const reserveQuote = baseIsToken0 ? reserves[1] : reserves[0];
  if (reserveBase <= 0n) {
    throw new Error(`Empty base reserve for pair ${pair}`);
  }

  const baseAmount = Number(reserveBase) / 10 ** baseDecimals;
  const quoteAmount = Number(reserveQuote) / 10 ** quoteDecimals;
  return quoteAmount / baseAmount;
}

export async function updatePrice(queries: Queries): Promise<void> {
  try {
    const [navBnb, bnbUsd, btcUsd] = await Promise.all([
      pairPrice(WNAV, WNAV_DECIMALS, WBNB, EVM_DECIMALS),
      pairPrice(WBNB, EVM_DECIMALS, USDT, EVM_DECIMALS),
      pairPrice(BTCB, EVM_DECIMALS, USDT, EVM_DECIMALS),
    ]);

    const navUsd = navBnb * bnbUsd;
    if (!Number.isFinite(navUsd) || navUsd <= 0) {
      console.warn(
        `[price] Invalid PancakeSwap price navBnb=${navBnb} bnbUsd=${bnbUsd}`
      );
      return;
    }
    const priceBtc = btcUsd > 0 ? navUsd / btcUsd : 0;

    const point: PriceHistoryPoint = {
      timestamp: Math.floor(Date.now() / 1000),
      price_usd: navUsd,
      price_btc: priceBtc,
      // PancakeSwap pair reserves don't expose 24h volume / market cap on-chain.
      volume_24h: 0,
      market_cap: 0,
    };

    queries.insertPricePoint(point);
    console.log(
      `[price] Updated (PancakeSwap wNAV/WBNB): $${point.price_usd.toFixed(
        6
      )} / ${point.price_btc.toFixed(8)} BTC (BNB $${bnbUsd.toFixed(2)})`
    );
  } catch (err) {
    console.error("[price] Error fetching PancakeSwap price:", err);
  }
}
