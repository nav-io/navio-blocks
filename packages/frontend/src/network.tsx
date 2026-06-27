import { createContext, useContext, type ReactNode } from 'react';

export type Network = 'mainnet' | 'testnet';

const STORAGE_KEY = 'navio-explorer-network';
const TESTNET_PREFIX = '/testnet';

/** Network for the current page load, derived from the URL path. */
export function detectNetwork(pathname: string = window.location.pathname): Network {
  return pathname === TESTNET_PREFIX || pathname.startsWith(`${TESTNET_PREFIX}/`)
    ? 'testnet'
    : 'mainnet';
}

/** Router basename for a network (mainnet at root, testnet under /testnet). */
export function basenameFor(network: Network): string {
  return network === 'testnet' ? TESTNET_PREFIX : '/';
}

/** Persist the user's last explicit network choice. */
export function rememberNetwork(network: Network): void {
  try {
    localStorage.setItem(STORAGE_KEY, network);
  } catch {
    /* storage unavailable — ignore */
  }
}

/** The last remembered network, or null if none/unavailable. */
export function rememberedNetwork(): Network | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === 'mainnet' || value === 'testnet' ? value : null;
  } catch {
    return null;
  }
}

/**
 * Build the absolute URL to view the same in-app path on the other network.
 * Switching networks is a hard navigation (the API base + router basename both
 * change), so callers use this as a plain link `href`.
 */
export function switchNetworkHref(target: Network): string {
  const current = detectNetwork();
  if (current === target) return window.location.pathname + window.location.search;

  // Strip an existing /testnet prefix to get the network-agnostic in-app path.
  let appPath = window.location.pathname;
  if (appPath === TESTNET_PREFIX) appPath = '/';
  else if (appPath.startsWith(`${TESTNET_PREFIX}/`)) appPath = appPath.slice(TESTNET_PREFIX.length);

  const prefix = target === 'testnet' ? TESTNET_PREFIX : '';
  const joined = `${prefix}${appPath}` || '/';
  return joined + window.location.search;
}

const NetworkContext = createContext<Network>('mainnet');

export function NetworkProvider({ network, children }: { network: Network; children: ReactNode }) {
  return <NetworkContext.Provider value={network}>{children}</NetworkContext.Provider>;
}

export function useNetwork(): Network {
  return useContext(NetworkContext);
}
