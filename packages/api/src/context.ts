import { AsyncLocalStorage } from "node:async_hooks";
import type { NetworkType } from "@navio-blocks/shared";

/**
 * Per-request network context. A single API process serves both mainnet and
 * testnet; the route bundle is registered twice (under `/api` and
 * `/api/testnet`) and an onRequest hook stamps the active network here so that
 * db / rpc / cache helpers stay network-aware without threading the value
 * through every call site.
 */
export const networkStore = new AsyncLocalStorage<NetworkType>();

export const NETWORKS: NetworkType[] = ["mainnet", "testnet"];

/** Network for the in-flight request; defaults to mainnet outside a request. */
export function currentNetwork(): NetworkType {
  return networkStore.getStore() ?? "mainnet";
}
