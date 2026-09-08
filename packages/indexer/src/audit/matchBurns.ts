/** A payout outflow detected from the audit (view-only) wallet. */
export interface PayoutFlow {
  spend_tx_hash: string;
  block_height: number;
  /**
   * Coins that left our ownership in the tx, net of the FULL tx fee
   * (ownedInputs − ownedChange − fee). This is only a LOWER bound of the amount
   * actually delivered: on a tx co-funded by inputs we don't own (e.g. a
   * re-stake that spends the bridge's staked commitment), part of the fee was
   * paid by those foreign inputs, so subtracting the whole fee under-counts.
   */
  net_sat: bigint;
  /** The tx's explicit PAY_FEE (sats). Delivered ∈ [net_sat, net_sat + fee_sat]. */
  fee_sat: bigint;
  /**
   * True if this tx creates a staked commitment. A pure stakelock's net can
   * coincide with a burn amount, so non-stake flows are matched FIRST — a real
   * payout claims its burn before a stakelock can absorb it, leaving genuine
   * stakes unmatched (to be classified as stakes, not payouts).
   */
  createsStake?: boolean;
}

/** A wNAV→Navio burn — an amount the bridge must deliver on Navio 1:1. */
export interface BurnAmount {
  amount_sat: bigint;
  timestamp: number;
  /** BSC burn tx hash (optional; carried through so awaiting burns can be listed). */
  tx_hash?: string;
  /** Destination Navio address from the burn note (optional). */
  note?: string | null;
}

export interface ReconciledPayout {
  spend_tx_hash: string;
  block_height: number;
  /**
   * Delivered NAVIO (sats). For a matched payout this is the exact sum of the
   * burn(s) it settled (the true amount the recipient received); for an
   * unmatched payout it falls back to the measured `net_sat`.
   */
  amount_sat: bigint;
  matched: boolean;
}

export interface MatchBurnsResult {
  payouts: ReconciledPayout[];
  /** Sum of burns settled 1:1 by a payout (sats) — the amount provably distributed. */
  settledSat: bigint;
  /** Burns not settled by any payout (sats) — burned but not yet paid ("awaiting"). */
  awaitingSat: bigint;
  /** Number of burns consumed by matches. */
  matchedBurnCount: number;
  /** Burns not settled by any payout — the specific pending payouts, newest first. */
  awaitingBurns: BurnAmount[];
  /**
   * Sum of the measured net of payouts that matched NO burn (sats) — coins that
   * left the wallet without a corresponding burn. A non-zero value is an
   * INCONSISTENCY (over-payment, manual withdrawal, or internal move) worth
   * surfacing, not silently folding into "distributed".
   */
  unmatchedPayoutSat: bigint;
  /** Number of payouts that matched no burn. */
  unmatchedPayoutCount: number;
}

/** Largest batch (burns settled by a single payout tx) we search for. */
const MAX_BATCH = 8;

/**
 * Reconcile audit-wallet payout outflows against wNAV burns for penny-exact
 * "distributed" totals.
 *
 * A view-only wallet measures how much left it in a payout tx (net = owned
 * inputs − owned change − fee), but the exact delivered amount drifts from that
 * net by up to one tx fee in EITHER direction: a co-funded tx (foreign inputs
 * pay part of the fee) reads net BELOW delivered, while a multi-recipient tx
 * (the bridge batches several burns into one send) reads net ABOVE the burn sum.
 * So the true delivered amount sits in a symmetric window:
 *
 *     Σ burns ∈ [net_sat − fee_sat, net_sat + fee_sat]
 *
 * The bridge delivers each burn 1:1 and may batch up to ~8 recipients per tx, so
 * a payout's burns are the subset that sums into that window. We match by
 * AMOUNT, not by order — the watchtower does not pay burns in occurrence order.
 * A matched payout reports the exact burn sum; anything unmatched keeps its
 * measured net and its burns stay "awaiting".
 *
 * Matching is greedy by batch size: every payout first tries to settle a single
 * burn, then leftovers try pairs, triples, … up to MAX_BATCH. Singles therefore
 * claim their burns before a larger batch can absorb them.
 */
export function matchPayoutsToBurns(
  payoutsIn: PayoutFlow[],
  burnsIn: BurnAmount[]
): MatchBurnsResult {
  // Deterministic order: oldest payout first, so equal-amount collisions settle
  // predictably. (Order is not relied on for correctness — amount is.)
  const payouts = [...payoutsIn].sort((a, b) => a.block_height - b.block_height);
  const burnObjs = [...burnsIn].sort((a, b) => a.timestamp - b.timestamp);
  const burns = burnObjs.map((b) => b.amount_sat);
  const consumed = new Array<boolean>(burns.length).fill(false);

  const settled = new Map<string, bigint>(); // spend_tx_hash -> delivered sat

  // Priority: non-stake flows before stake-creating flows, and within each,
  // EXACT (burn sum == net) before FUZZY (± fee). A pure stakelock's net can
  // coincide with a burn amount (even exactly), so a real payout — which is not
  // a stake tx — must get first claim on the burn; the stakelock is then left
  // unmatched and classified as a stake, not a payout.
  for (const stakePhase of [false, true]) {
    for (const exact of [true, false]) {
      for (let size = 1; size <= MAX_BATCH; size++) {
        for (const p of payouts) {
          if (settled.has(p.spend_tx_hash)) continue;
          if (!!p.createsStake !== stakePhase) continue;
          const tol = exact ? 0n : p.fee_sat;
          const lo = p.net_sat - tol > 0n ? p.net_sat - tol : 1n;
          const picked = findSubset(burns, consumed, lo, p.net_sat + tol, size);
          if (picked) {
            let sum = 0n;
            for (const j of picked) {
              consumed[j] = true;
              sum += burns[j];
            }
            settled.set(p.spend_tx_hash, sum);
          }
        }
      }
    }
  }

  let settledSat = 0n;
  let unmatchedPayoutSat = 0n;
  let unmatchedPayoutCount = 0;
  const outPayouts: ReconciledPayout[] = payouts.map((p) => {
    const delivered = settled.get(p.spend_tx_hash);
    if (delivered !== undefined) {
      settledSat += delivered;
    } else {
      unmatchedPayoutSat += p.net_sat;
      unmatchedPayoutCount++;
    }
    return {
      spend_tx_hash: p.spend_tx_hash,
      block_height: p.block_height,
      amount_sat: delivered ?? p.net_sat,
      matched: delivered !== undefined,
    };
  });

  let awaitingSat = 0n;
  let matchedBurnCount = 0;
  const awaitingBurns: BurnAmount[] = [];
  for (let j = 0; j < burns.length; j++) {
    if (consumed[j]) {
      matchedBurnCount++;
    } else {
      awaitingSat += burns[j];
      awaitingBurns.push(burnObjs[j]);
    }
  }
  awaitingBurns.reverse(); // newest first

  return {
    payouts: outPayouts,
    settledSat,
    awaitingSat,
    matchedBurnCount,
    awaitingBurns,
    unmatchedPayoutSat,
    unmatchedPayoutCount,
  };
}

/**
 * Find exactly `size` unconsumed burns whose sum lands in [lo, hi]. Prefers the
 * subset whose sum is closest to the window centre. Returns the chosen indices,
 * or null if none fits. Candidates are sorted descending with branch-and-bound
 * pruning (overshoot above `hi`, and unreachable-`lo` cutoff) so the search
 * stays cheap even at MAX_BATCH.
 */
function findSubset(
  burns: bigint[],
  consumed: boolean[],
  lo: bigint,
  hi: bigint,
  size: number
): number[] | null {
  // Available burn indices, largest first (enables both prunes below).
  const cand: number[] = [];
  for (let j = 0; j < burns.length; j++) if (!consumed[j]) cand.push(j);
  cand.sort((a, b) => (burns[b] > burns[a] ? 1 : burns[b] < burns[a] ? -1 : 0));
  const m = cand.length;
  const mid = (lo + hi) / 2n;

  let best: number[] | null = null;
  let bestDist = 0n;
  const pick: number[] = [];

  const recurse = (start: number, remaining: number, acc: bigint): void => {
    if (remaining === 0) {
      if (acc >= lo && acc <= hi) {
        const dist = acc > mid ? acc - mid : mid - acc;
        if (best === null || dist < bestDist) {
          best = [...pick];
          bestDist = dist;
        }
      }
      return;
    }
    for (let i = start; i < m; i++) {
      const v = burns[cand[i]];
      const na = acc + v;
      // Overshoot: this item busts the window. Later items are smaller and may
      // still fit, so skip rather than break.
      if (na > hi) continue;
      // Unreachable: even taking the `remaining` largest items from here can't
      // reach `lo`. Since candidates are descending, every later start is worse
      // too — cut the whole branch.
      let maxReach = na;
      for (let k = i + 1; k < i + remaining && k < m; k++) maxReach += burns[cand[k]];
      if (maxReach < lo) break;
      pick.push(cand[i]);
      recurse(i + 1, remaining - 1, na);
      pick.pop();
    }
  };
  recurse(0, size, 0n);
  return best;
}
