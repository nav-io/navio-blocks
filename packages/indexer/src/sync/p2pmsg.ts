import type { NetworkType } from "@navio-blocks/shared";
import type { RpcClient } from "../rpc/client.js";
import type { Queries } from "../db/queries.js";

/** Coerce an RPC value to a non-negative integer, falling back to 0. */
function toInt(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.round(value));
  }
  if (typeof value === "bigint") return Math.max(0, Number(value));
  if (typeof value === "string") {
    const n = Number(value);
    if (Number.isFinite(n)) return Math.max(0, Math.round(n));
  }
  return fallback;
}

/** Coerce an RPC value to a trimmed non-empty string, or null. */
function toStringOrNull(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  return null;
}

/**
 * Poll the node's p2pmsg / P2P overlay RPCs and persist a time-series snapshot.
 *
 * Every RPC used here degrades gracefully (the RpcClient wrappers swallow
 * method-not-found / "p2pmsg disabled" and return disabled/empty results), so
 * this runs harmlessly against a pre-p2pmsg node — it simply records
 * `enabled = 0` snapshots with the current connected-peer count.
 */
export async function updateP2pmsg(
  rpc: RpcClient,
  queries: Queries,
  network: NetworkType = "mainnet"
): Promise<void> {
  try {
    const now = Math.floor(Date.now() / 1000);

    const [info, hint, orders, rfqs, peers] = await Promise.all([
      rpc.getP2pmsgInfo(),
      rpc.getAggregationHint(),
      rpc.listOrders(),
      rpc.listRfqs(),
      // Total connected peers: the node's own peer list, same source updatePeers
      // uses for direct peers. Best-effort — never let it abort the snapshot.
      rpc.getPeerInfo().catch(() => [] as unknown[]),
    ]);

    const totalPeers = Array.isArray(peers) ? peers.length : 0;
    const enabled =
      info.enabled === true ||
      hint.enabled === true ||
      orders.enabled === true ||
      rfqs.length > 0;

    queries.insertP2pmsgSnapshot({
      timestamp: now,
      network,
      enabled: enabled ? 1 : 0,
      relay_capable_peers: toInt(info.relay_capable_peers),
      total_peers: totalPeers,
      agg_available: toInt(hint.available),
      agg_extra_fee_per_candidate: toInt(hint.extra_fee_per_candidate),
      orders_count: toInt(orders.count),
      orders_bytes: toInt(orders.bytes),
      rfqs_count: rfqs.length,
      pings_received: toInt(info.pings_received),
      identity_pubkey: toStringOrNull(info.identity_pubkey),
      inbox_pubkey: toStringOrNull(info.inbox_pubkey),
    });

    if (enabled) {
      console.log(
        `[p2pmsg] Snapshot: relay-capable ${toInt(
          info.relay_capable_peers
        )}/${totalPeers} peers, anonymity set ${toInt(
          hint.available
        )}, orders ${toInt(orders.count)}, rfqs ${rfqs.length}`
      );
    } else {
      console.log(
        `[p2pmsg] Overlay not available on this node (recorded ${totalPeers} connected peers)`
      );
    }
  } catch (err) {
    console.error("[p2pmsg] Error updating p2pmsg stats:", err);
  }
}
