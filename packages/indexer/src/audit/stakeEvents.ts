import type { NavioAuditStakeEventRow } from "../db/queries.js";

/** Per-tx outflow the audit wallet incurred (owned inputs spent, minus owned change received back). */
export interface SpentFlow {
  inputs: bigint;
  changeOut: bigint;
  block: number;
}

/** Per-tx inflow the audit wallet received. */
export interface ReceivedFlow {
  amount: bigint;
  block: number;
}

export interface DeriveStakeEventsInput {
  /** Txid -> outflow, keyed by the tx that spent the wallet's outputs. */
  spentByTx: Map<string, SpentFlow>;
  /** Txid -> inflow, keyed by the tx that produced the wallet's outputs. */
  receivedByTx: Map<string, ReceivedFlow>;
  /** Txids that CREATE a staked commitment (from the explorer's block sync). */
  stakeTxids: Set<string>;
  /** Txids that SPEND a staked commitment (from the explorer's block sync). */
  unstakeTxids: Set<string>;
}

export interface DeriveStakeEventsResult {
  events: NavioAuditStakeEventRow[];
  /**
   * Txids that are stake operations and must be removed from the outgoing
   * payout list — a stakelock spends the wallet's coins into a commitment the
   * (view-only) audit wallet does not own, so it otherwise looks like a payout.
   */
  excludeFromOutgoing: Set<string>;
}

/**
 * Derive stake / unstake events for an audited wallet.
 *
 * The audit (view-only) wallet does NOT own the staked-commitment output
 * itself, so we cannot detect stakes by owned-output type. Instead we combine:
 *   - the explorer's block sync, which knows which txs create (`stakeTxids`)
 *     and spend (`unstakeTxids`) staked commitments, and
 *   - the audit wallet's value flow, which supplies the amounts.
 *
 * A tx that creates a stake AND drew coins out of the wallet is a `stake` of
 * `inputs - changeOut`. A tx that spends a stake AND paid coins into the wallet
 * is an `unstake` of `received`.
 */
export function deriveStakeEvents(input: DeriveStakeEventsInput): DeriveStakeEventsResult {
  const { spentByTx, receivedByTx, stakeTxids, unstakeTxids } = input;
  const events: NavioAuditStakeEventRow[] = [];
  const excludeFromOutgoing = new Set<string>();

  for (const [txid, flow] of spentByTx) {
    if (!stakeTxids.has(txid)) continue;
    const amount = flow.inputs - flow.changeOut;
    if (amount <= 0n) continue;
    events.push({
      tx_hash: txid,
      event_type: "stake",
      block_height: flow.block,
      amount_sat: amount.toString(),
    });
    excludeFromOutgoing.add(txid);
  }

  for (const [txid, flow] of receivedByTx) {
    if (!unstakeTxids.has(txid)) continue;
    if (flow.amount <= 0n) continue;
    events.push({
      tx_hash: txid,
      event_type: "unstake",
      block_height: flow.block,
      amount_sat: flow.amount.toString(),
    });
  }

  events.sort((a, b) => b.block_height - a.block_height);
  return { events, excludeFromOutgoing };
}
