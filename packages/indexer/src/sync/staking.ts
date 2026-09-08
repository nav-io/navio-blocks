import type { NetworkType } from "@navio-blocks/shared";
import type { RpcClient } from "../rpc/client.js";
import type { Queries } from "../db/queries.js";
import { isDelegationPredicateHex } from "./block.js";

/**
 * Snapshot the node's public unspent staked-commitment set
 * (`liststakedcommitmentsdata`) next to the explorer's own count.
 *
 * The node view is authoritative for "how many commitments are staking right
 * now" and lets the staking page chart the staked set over time; comparing it
 * with the index catches classification drift (e.g. a delegated stake being
 * mis-filed) without trusting either side alone. Amounts are BLSCT-hidden and
 * never part of this data.
 *
 * Degrades gracefully: a node without the RPC yields no snapshot (not a zero).
 */
export async function updateStaking(
  rpc: RpcClient,
  queries: Queries,
  network: NetworkType = "mainnet"
): Promise<void> {
  try {
    const [commitments, height] = await Promise.all([
      rpc.listStakedCommitmentsData(),
      rpc.getBlockCount().catch(() => 0),
    ]);
    if (commitments === null) {
      console.log("[staking] liststakedcommitmentsdata unavailable on this node; skipping snapshot");
      return;
    }

    const active = commitments.length;
    let delegated = 0;
    for (const c of commitments) {
      if (isDelegationPredicateHex(c.predicate)) delegated++;
    }

    const db = queries.stakeCommitmentCounts();
    const now = Math.floor(Date.now() / 1000);
    queries.insertStakingSnapshot({
      timestamp: now,
      network,
      node_height: height,
      active_commitments: active,
      delegated_commitments: delegated,
      db_active: db.active,
      db_delegated: db.delegated,
    });

    const drift = active !== db.active || delegated !== db.delegated;
    console.log(
      `[staking] Snapshot @${height}: node ${active} staked (${delegated} delegated), index ${db.active} (${db.delegated} delegated)${drift ? " — DRIFT" : ""}`
    );
  } catch (err) {
    console.error("[staking] Snapshot failed:", err instanceof Error ? err.message : err);
  }
}
