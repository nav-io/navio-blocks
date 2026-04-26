import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { NetworkType } from "@navio-blocks/shared";
import type { NavioClient as NavioClientType } from "navio-sdk";
import type { Queries } from "../db/queries.js";

/** Use CJS entry so `better-sqlite3` / `fs` load via real `require` (ESM bundle uses a broken `__require` shim). */
const requireSdk = createRequire(import.meta.url);
function getNavioClientClass(): typeof NavioClientType {
  return requireSdk("navio-sdk").NavioClient as typeof NavioClientType;
}

export interface NavioAuditEnvConfig {
  auditKeyHex: string;
  walletDbPath: string;
  network: NetworkType;
  restoreFromHeight: number;
  electrum: { host: string; port: number; ssl: boolean };
}

export function resolveNavioAuditConfig(
  network: NetworkType,
  explorerDbPath: string
): NavioAuditEnvConfig | null {
  const auditKeyHex =
    process.env.NAVIO_AUDIT_KEY?.trim() || process.env.AUDIT_KEY?.trim() || "";
  if (!auditKeyHex) return null;
  if (
    process.env.NAVIO_AUDIT_ENABLED === "0" ||
    process.env.NAVIO_AUDIT_ENABLED === "false"
  ) {
    return null;
  }

  const walletDbPath =
    process.env.NAVIO_AUDIT_WALLET_PATH?.trim() ||
    join(dirname(explorerDbPath), "navio-audit-wallet.db");

  const host =
    process.env.NAVIO_ELECTRUM_HOST?.trim() ||
    (network === "testnet" ? "testnet.nav.io" : "mainnet.nav.io");

  const ssl =
    process.env.NAVIO_ELECTRUM_SSL === "0" ||
    process.env.NAVIO_ELECTRUM_SSL === "false"
      ? false
      : true;

  // navio-sdk's ElectrumClient is WebSocket-based (`ws://` / `wss://`).
  // Servers expose: 50001 tcp, 50002 ssl, 50005 ws, 50004 wss.
  // We must use the WebSocket ports here.
  const defaultPort = ssl ? "50004" : "50005";
  const port = parseInt(process.env.NAVIO_ELECTRUM_PORT || defaultPort, 10);

  const restoreFromHeight = parseInt(
    process.env.NAVIO_AUDIT_RESTORE_HEIGHT ||
      process.env.AUDIT_RESTORE_HEIGHT ||
      "0",
    10
  );

  return {
    auditKeyHex,
    walletDbPath,
    network,
    restoreFromHeight: Number.isNaN(restoreFromHeight) ? 0 : restoreFromHeight,
    electrum: {
      host,
      port: Number.isNaN(port) ? (ssl ? 50004 : 50005) : port,
      ssl,
    },
  };
}

function outAmount(o: { amount: bigint | number | string }): bigint {
  const a = o.amount;
  if (typeof a === "bigint") return a;
  if (typeof a === "number") return BigInt(Math.trunc(a));
  return BigInt(a);
}

let auditSyncRunning = false;

/**
 * Sync the BLSCT audit wallet via navio-sdk (Electrum), then persist outgoing
 * native-coin payouts into the explorer DB (same derivation as navio-bridge).
 */
export async function syncNavioAuditWallet(
  queries: Queries,
  config: NavioAuditEnvConfig
): Promise<void> {
  if (auditSyncRunning) {
    console.log("[navio-audit] Sync already in progress, skip");
    return;
  }
  auditSyncRunning = true;
  const NavioClient = getNavioClientClass();
  let client: InstanceType<typeof NavioClient> | null = null;
  try {
    console.log(
      "[navio-audit] Starting sync (electrum %s:%s ssl=%s, wallet %s)",
      config.electrum.host,
      config.electrum.port,
      config.electrum.ssl,
      config.walletDbPath
    );
    client = new NavioClient({
      walletDbPath: config.walletDbPath,
      databaseAdapter: "better-sqlite3",
      backend: "electrum",
      electrum: config.electrum,
      network: config.network,
      createWalletIfNotExists: true,
      restoreFromAuditKey: config.auditKeyHex,
      restoreFromHeight: config.restoreFromHeight,
    });
    await client.initialize();
    const tip = await client.sync();
    const outputs = await client.getAllOutputs();
    const bal = await client.getBalance();
    await client.disconnect().catch(() => {});
    client = null;

    const spentBySpendTx = new Map<
      string,
      { inputs: bigint; changeOut: bigint; block: number }
    >();
    const receivedByTx = new Map<string, bigint>();

    for (const o of outputs) {
      if (!o.tokenId) {
        const amt = outAmount(o);
        const prev = receivedByTx.get(o.txHash) ?? 0n;
        receivedByTx.set(o.txHash, prev + amt);
        if (o.isSpent && o.spentTxHash) {
          const e = spentBySpendTx.get(o.spentTxHash) ?? {
            inputs: 0n,
            changeOut: 0n,
            block: o.spentBlockHeight ?? 0,
          };
          e.inputs += amt;
          if (o.spentBlockHeight) e.block = o.spentBlockHeight;
          spentBySpendTx.set(o.spentTxHash, e);
        }
      }
    }

    for (const spendTx of spentBySpendTx.keys()) {
      const entry = spentBySpendTx.get(spendTx)!;
      entry.changeOut = receivedByTx.get(spendTx) ?? 0n;
    }

    const outgoingRows = [...spentBySpendTx.entries()]
      .map(([hash, e]) => ({
        spend_tx_hash: hash,
        block_height: e.block,
        amount_sat: (e.inputs - e.changeOut).toString(),
      }))
      .filter((r) => BigInt(r.amount_sat) > 0n)
      .sort((a, b) => b.block_height - a.block_height);

    const balanceSat =
      typeof bal === "bigint" ? bal.toString() : String(bal);

    const now = Math.floor(Date.now() / 1000);
    queries.replaceNavioAuditData(
      {
        balance_sat: balanceSat,
        synced_height: tip,
        chain_tip: tip,
        error_message: null,
        updated_at: now,
      },
      outgoingRows
    );
    console.log(
      "[navio-audit] Synced to tip %s, %d outgoing payout(s), balance %s sat",
      tip,
      outgoingRows.length,
      balanceSat
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[navio-audit] Sync failed:", msg);
    queries.recordNavioAuditFailure(msg);
    if (client) {
      await client.disconnect().catch(() => {});
    }
  } finally {
    auditSyncRunning = false;
  }
}
