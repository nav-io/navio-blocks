import type { NetworkType } from '@navio-blocks/shared';

const COIN = 100_000_000; // 1 NAV = 100M satoshis
const MAX_SUPPLY = 250_000_000 * COIN;
const HALVING_INTERVAL = 210_000;
const INITIAL_SUBSIDY = 50 * COIN;
const BLSCT_BLOCK_REWARD = 4 * COIN;
const BLSCT_FIRST_BLOCK_REWARD = 75_000_000 * COIN;
const LAST_POW_HEIGHT = 1000;

export function getBlockSubsidy(height: number): number {
  const halvings = Math.floor(height / HALVING_INTERVAL);
  if (halvings >= 64) return 0;
  // Use BigInt for the shift to avoid JS number precision issues
  return Number(BigInt(INITIAL_SUBSIDY) >> BigInt(halvings));
}

export function getExpectedBlockReward(height: number, network: NetworkType, isBlsct: boolean): number {
  // On mainnet, BLSCT is not active (fBLSCT=false), so all blocks use PoW subsidy
  if (network === 'mainnet') {
    return getBlockSubsidy(height);
  }

  // Testnet with fBLSCT=true:
  // Height 1 always gets the 75M bootstrap on fBLSCT networks,
  // even if there are PoW blocks at the beginning
  if (height === 1) {
    return BLSCT_FIRST_BLOCK_REWARD;
  }

  // BLSCT blocks (detected via version bit 0x40000000) get fixed 4 NAV reward
  if (isBlsct) {
    return BLSCT_BLOCK_REWARD;
  }

  // Non-BLSCT (PoW) blocks use standard halving subsidy
  return getBlockSubsidy(height);
}

export { MAX_SUPPLY, COIN };
