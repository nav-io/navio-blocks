import { createRequire } from "node:module";
import { rmSync } from "node:fs";
import { dirname, join } from "node:path";
import type { NetworkType } from "@navio-blocks/shared";
import type { NavioClient as NavioClientType } from "navio-sdk";
import type { Queries, NavioAuditStakeEventRow } from "../db/queries.js";
import { matchPayoutsToBurns, type PayoutFlow } from "./matchBurns.js";

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
    await client.sync();
    // client.sync() returns blocks-processed-this-run, not the chain tip — use
    // the real tip so synced_height is correct on incremental syncs too.
    const tip = (await client.getChainTip()).height;
    const outputs = await client.getAllOutputs();
    const bal = await client.getBalance();
    await client.disconnect().catch(() => {});
    client = null;

    const spentBySpendTx = new Map<
      string,
      { inputs: bigint; changeOut: bigint; block: number }
    >();
    const receivedByTx = new Map<string, { amount: bigint; block: number }>();

    // Earned staking rewards = owned coinbase outputs from PoS blocks (the
    // explorer flags coinbase txs; block 1's whole-supply mint is excluded).
    const rewardTxids = queries.coinbaseRewardTxids();
    let earnedRewardsSat = 0n;

    for (const o of outputs) {
      if (!o.tokenId) {
        const amt = outAmount(o);
        if (rewardTxids.has(o.txHash)) earnedRewardsSat += amt;
        const prev = receivedByTx.get(o.txHash) ?? { amount: 0n, block: o.blockHeight ?? 0 };
        prev.amount += amt;
        if (o.blockHeight) prev.block = o.blockHeight;
        receivedByTx.set(o.txHash, prev);
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
      entry.changeOut = receivedByTx.get(spendTx)?.amount ?? 0n;
    }

    // Txs that create a staked commitment (`stakeTxids`) or spend one
    // (`unstakeTxids`), from the explorer's block sync. The payout wallet
    // re-stakes its change on almost every send, so a tx can be BOTH a burn
    // payout AND a stakelock. We reconcile ALL outflows against burns first,
    // then split each outflow into its payout part and its staked part.
    const stakeTxids = queries.stakeTxids();
    const unstakeTxids = queries.unstakeTxids();

    // `inputs - changeOut - fee` is the coin that left the wallet to non-owned
    // outputs (burn recipients + re-staked change). The amount delivered to burn
    // recipients drifts from this by up to one tx fee in EITHER direction
    // (co-funded inputs vs. multi-recipient batching), which the matcher's
    // symmetric window absorbs. Feed EVERY owned spend as a payout candidate.
    const feeByTxid = queries.feeSatByTxid();
    const payoutFlows: PayoutFlow[] = [...spentBySpendTx.entries()]
      .map(([hash, e]) => {
        const fee = feeByTxid.get(hash) ?? 0n;
        return {
          spend_tx_hash: hash,
          block_height: e.block,
          net_sat: e.inputs - e.changeOut - fee,
          fee_sat: fee,
          createsStake: stakeTxids.has(hash),
        };
      })
      .filter((r) => r.net_sat > 0n);

    // Reconcile against the wNAV burns and snap each payout to the exact burn
    // sum it settled, so "distributed" reconciles penny-exact with "burned".
    const { payouts: matched, settledSat, awaitingSat, matchedBurnCount, awaitingBurns } =
      matchPayoutsToBurns(payoutFlows, queries.bscWnavBurnsAsc());
    const deliveredByTx = new Map<string, bigint>();
    for (const p of matched) if (p.matched) deliveredByTx.set(p.spend_tx_hash, p.amount_sat);

    // Split every owned spend: a matched burn payout keeps the exact burn sum;
    // whatever left the wallet beyond that on a stake-creating tx is re-staked
    // change (a `stake` event of net − delivered); a stake-creating tx with no
    // burn is a pure stakelock (`stake` of its whole net); and a spend that is
    // neither a burn nor a stake is a genuinely unreconciled outflow. A tx that
    // spends a staked commitment releases coins back to us (an `unstake`).
    const STAKE_DUST = 1_000_000n; // 0.01 NAV — ignore fee-sized residue
    const outgoingRows: { spend_tx_hash: string; block_height: number; amount_sat: string; matched: number }[] = [];
    const stakeEventRows: NavioAuditStakeEventRow[] = [];
    let unmatchedPayoutSat = 0n;
    let unmatchedPayoutCount = 0;
    for (const [hash, e] of spentBySpendTx) {
      const fee = feeByTxid.get(hash) ?? 0n;
      const net = e.inputs - e.changeOut - fee;
      const delivered = deliveredByTx.get(hash) ?? 0n;
      const createsStake = stakeTxids.has(hash);
      if (net > 0n) {
        if (delivered > 0n) {
          outgoingRows.push({ spend_tx_hash: hash, block_height: e.block, amount_sat: delivered.toString(), matched: 1 });
          const staked = net - delivered;
          if (createsStake && staked > STAKE_DUST) {
            stakeEventRows.push({ tx_hash: hash, event_type: "stake", block_height: e.block, amount_sat: staked.toString() });
          }
        } else if (createsStake) {
          stakeEventRows.push({ tx_hash: hash, event_type: "stake", block_height: e.block, amount_sat: net.toString() });
        } else {
          outgoingRows.push({ spend_tx_hash: hash, block_height: e.block, amount_sat: net.toString(), matched: 0 });
          unmatchedPayoutSat += net;
          unmatchedPayoutCount++;
        }
      }
      // Only a PURE unstake (spends a staked commitment without re-creating one)
      // is a real unstake. A compound re-stake spends AND re-creates a stake, so
      // its staking nets to ~0 — counting its large "received" as an unstake
      // would wildly skew net_staked; it's already handled as a payout above.
      if (unstakeTxids.has(hash) && !createsStake) {
        const recv = receivedByTx.get(hash)?.amount ?? 0n;
        if (recv > STAKE_DUST) {
          stakeEventRows.push({ tx_hash: hash, event_type: "unstake", block_height: e.block, amount_sat: recv.toString() });
        }
      }
    }
    outgoingRows.sort((a, b) => b.block_height - a.block_height);
    stakeEventRows.sort((a, b) => b.block_height - a.block_height);

    const balanceSat =
      typeof bal === "bigint" ? bal.toString() : String(bal);

    const now = Math.floor(Date.now() / 1000);
    queries.replaceNavioAuditData(
      {
        balance_sat: balanceSat,
        earned_rewards_sat: earnedRewardsSat.toString(),
        synced_height: tip,
        chain_tip: tip,
        error_message: null,
        updated_at: now,
        settled_sat: settledSat.toString(),
        awaiting_sat: awaitingSat.toString(),
        unmatched_payout_sat: unmatchedPayoutSat.toString(),
        unmatched_payout_count: unmatchedPayoutCount,
      },
      outgoingRows,
      stakeEventRows,
      awaitingBurns.map((b) => ({
        tx_hash: b.tx_hash ?? null,
        amount_sat: b.amount_sat.toString(),
        timestamp: b.timestamp,
        note: b.note ?? null,
      }))
    );
    console.log(
      "[navio-audit] Synced to tip %s, %d payout(s): %d burn(s) settled, %s sat awaiting, %d unmatched (%s sat); %d stake event(s), balance %s sat",
      tip,
      outgoingRows.length,
      matchedBurnCount,
      awaitingSat.toString(),
      unmatchedPayoutCount,
      unmatchedPayoutSat.toString(),
      stakeEventRows.length,
      balanceSat
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[navio-audit] Sync failed:", msg);
    queries.recordNavioAuditFailure(msg);
    if (client) {
      await client.disconnect().catch(() => {});
      client = null;
    }
    // The BLSCT wallet throws on a chain reorg instead of reverting, then loops
    // forever failing on the same stale block hash — freezing payouts while
    // burns keep arriving (looks like a huge phantom "awaiting"). Recover by
    // discarding the view-only wallet so the next tick re-scans the canonical
    // chain from scratch (it holds no keys — all derived from AUDIT_KEY).
    if (/reorg|revert|reorganization/i.test(msg)) {
      console.warn("[navio-audit] Reorg detected — resetting wallet for a fresh re-sync: %s", config.walletDbPath);
      for (const suffix of ["", "-wal", "-shm"]) {
        try {
          rmSync(`${config.walletDbPath}${suffix}`, { force: true });
        } catch (e) {
          console.error("[navio-audit] Failed to remove %s%s: %s", config.walletDbPath, suffix, (e as Error).message);
        }
      }
    }
  } finally {
    auditSyncRunning = false;
  }
}
