import type { NavioAuditStakeEventRow } from "../db/queries.js";

/** Minimal owned-output shape needed to derive stake events (subset of the SDK's WalletOutput). */
export interface OwnedOutputLite {
  txHash: string;
  outputIndex: number;
  blockHeight: number;
  amount: bigint | number | string;
  tokenId: string | null;
  isSpent: boolean;
  spentTxHash: string | null;
  spentBlockHeight: number | null;
}

function toBigint(a: bigint | number | string): bigint {
  if (typeof a === "bigint") return a;
  if (typeof a === "number") return BigInt(Math.trunc(a));
  return BigInt(a);
}

/**
 * Derive stake / unstake events for an audited wallet.
 *
 * @param outputs   the wallet's owned outputs (from the audit-key sync)
 * @param stakeKeys set of "txid:n" the explorer classified as staked commitments
 *
 * An owned staked-commitment output is a `stake` event on the tx that created
 * it. When such an output is later spent by a tx that does NOT itself create a
 * new owned stake (a genuine unlock, not a consolidation / re-stake), that spend
 * is an `unstake` event. Amounts are summed per tx; native coin only (tokens are
 * never staked commitments).
 */
export function deriveStakeEvents(
  outputs: OwnedOutputLite[],
  stakeKeys: Set<string>
): NavioAuditStakeEventRow[] {
  const ownedStakeOutputs = outputs.filter(
    (o) => !o.tokenId && stakeKeys.has(`${o.txHash}:${o.outputIndex}`)
  );
  const stakeTxs = new Set(ownedStakeOutputs.map((o) => o.txHash));

  const stakeByTx = new Map<string, { block: number; amount: bigint }>();
  const unstakeByTx = new Map<string, { block: number; amount: bigint }>();

  for (const o of ownedStakeOutputs) {
    const amt = toBigint(o.amount);
    const s = stakeByTx.get(o.txHash) ?? { block: o.blockHeight, amount: 0n };
    s.amount += amt;
    stakeByTx.set(o.txHash, s);

    if (o.isSpent && o.spentTxHash && !stakeTxs.has(o.spentTxHash)) {
      const u = unstakeByTx.get(o.spentTxHash) ?? {
        block: o.spentBlockHeight ?? 0,
        amount: 0n,
      };
      u.amount += amt;
      unstakeByTx.set(o.spentTxHash, u);
    }
  }

  return [
    ...[...stakeByTx.entries()].map(([hash, e]) => ({
      tx_hash: hash,
      event_type: "stake" as const,
      block_height: e.block,
      amount_sat: e.amount.toString(),
    })),
    ...[...unstakeByTx.entries()].map(([hash, e]) => ({
      tx_hash: hash,
      event_type: "unstake" as const,
      block_height: e.block,
      amount_sat: e.amount.toString(),
    })),
  ].sort((a, b) => b.block_height - a.block_height);
}
