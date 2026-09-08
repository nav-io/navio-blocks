/**
 * Tests for burn↔payout reconciliation.
 * Run: npm -w packages/indexer test   (tsx, no framework — throws on failure)
 */
import assert from "node:assert/strict";
import { matchPayoutsToBurns } from "./matchBurns.js";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ok - ${name}`);
}

check("simple payout: net already equals the burn, matches exactly", () => {
  const r = matchPayoutsToBurns(
    [{ spend_tx_hash: "a", block_height: 10, net_sat: 1_004_618_000_000n, fee_sat: 200_000n }],
    [{ amount_sat: 1_004_618_000_000n, timestamp: 100 }]
  );
  assert.equal(r.payouts[0].matched, true);
  assert.equal(r.payouts[0].amount_sat, 1_004_618_000_000n);
  assert.equal(r.awaitingSat, 0n);
});

check("compound re-stake: net is fee-short, snaps up to the exact burn", () => {
  // Real case tx 742484…: net = 4997.415785, fee = 0.010215, burn = 4997.42.
  // delivered ∈ [4997.415785, 4997.426] and the burn 4997.42 sits inside it.
  const r = matchPayoutsToBurns(
    [{ spend_tx_hash: "742484", block_height: 1174, net_sat: 499_741_578_500n, fee_sat: 1_021_500n }],
    [{ amount_sat: 499_742_000_000n, timestamp: 1783011481 }]
  );
  assert.equal(r.payouts[0].matched, true);
  assert.equal(r.payouts[0].amount_sat, 499_742_000_000n, "reports the exact 4997.42 delivered");
  assert.equal(r.awaitingSat, 0n);
});

check("batched payout settles multiple burns (oldest first)", () => {
  // One tx paid two burns: 50000 + 5000.01 = 55000.01.
  const r = matchPayoutsToBurns(
    [{ spend_tx_hash: "batch", block_height: 1168, net_sat: 5_500_001_000_000n, fee_sat: 500_000n }],
    [
      { amount_sat: 5_000_000_000_000n, timestamp: 100 }, // 50000
      { amount_sat: 500_001_000_000n, timestamp: 200 }, // 5000.01
    ]
  );
  assert.equal(r.payouts[0].matched, true);
  assert.equal(r.payouts[0].amount_sat, 5_500_001_000_000n);
  assert.equal(r.matchedBurnCount, 2);
  assert.equal(r.awaitingSat, 0n);
});

check("unpaid burn shows as awaiting, paid ones reconcile", () => {
  const r = matchPayoutsToBurns(
    [{ spend_tx_hash: "a", block_height: 10, net_sat: 100_000_000n, fee_sat: 1000n }],
    [
      { amount_sat: 100_000_000n, timestamp: 100, tx_hash: "paid" }, // paid
      { amount_sat: 4_997_420_000_00n, timestamp: 200, tx_hash: "pending", note: "nav1dest" }, // not yet paid
    ]
  );
  assert.equal(r.payouts[0].matched, true);
  assert.equal(r.awaitingSat, 499_742_000_000n, "the unpaid burn is still awaiting");
  assert.equal(r.awaitingBurns.length, 1, "the specific pending burn is listed");
  assert.equal(r.awaitingBurns[0].tx_hash, "pending");
  assert.equal(r.awaitingBurns[0].note, "nav1dest");
});

check("matches by amount, not by order (burns paid out of sequence)", () => {
  // Burn order (by time) is 100 then 200, but the bridge paid the 200 first.
  // Amount matching must still settle both.
  const r = matchPayoutsToBurns(
    [
      { spend_tx_hash: "paid200first", block_height: 10, net_sat: 200n, fee_sat: 10n },
      { spend_tx_hash: "paid100next", block_height: 20, net_sat: 100n, fee_sat: 10n },
    ],
    [
      { amount_sat: 100n, timestamp: 1 },
      { amount_sat: 200n, timestamp: 2 },
    ]
  );
  const byTx = Object.fromEntries(r.payouts.map((p) => [p.spend_tx_hash, p]));
  assert.equal(byTx.paid200first.amount_sat, 200n);
  assert.equal(byTx.paid100next.amount_sat, 100n);
  assert.equal(r.awaitingSat, 0n);
});

check("tiny burns that don't prefix-sum still each match their payout", () => {
  // The FIFO bug: equal/near-equal tiny burns in an order that doesn't line up
  // with payouts. Amount matching settles each one-for-one.
  const burns = [
    { amount_sat: 500_000n, timestamp: 1 },
    { amount_sat: 500_000n, timestamp: 2 },
    { amount_sat: 800_000n, timestamp: 3 },
    { amount_sat: 962_000n, timestamp: 4 },
  ];
  const payouts = [
    { spend_tx_hash: "a", block_height: 10, net_sat: 962_000n, fee_sat: 2000n },
    { spend_tx_hash: "b", block_height: 11, net_sat: 500_000n, fee_sat: 2000n },
    { spend_tx_hash: "c", block_height: 12, net_sat: 800_000n, fee_sat: 2000n },
    { spend_tx_hash: "d", block_height: 13, net_sat: 500_000n, fee_sat: 2000n },
  ];
  const r = matchPayoutsToBurns(payouts, burns);
  assert.equal(r.matchedBurnCount, 4);
  assert.equal(r.awaitingSat, 0n);
  assert.ok(r.payouts.every((p) => p.matched));
});

check("multi-recipient tx: net sits ABOVE the burn sum (symmetric window)", () => {
  // Real case blk2487: one 6-output tx paid two burns (20000 + 19999.6036);
  // measured net 39999.6116 reads ~0.008 ABOVE the burn sum (fee on the far
  // side). delivered = net − fee, so the symmetric window must catch it.
  const r = matchPayoutsToBurns(
    [{ spend_tx_hash: "batch2", block_height: 2487, net_sat: 3_999_961_160_000n, fee_sat: 800_000n }],
    [
      { amount_sat: 2_000_000_000_000n, timestamp: 1 }, // 20000
      { amount_sat: 1_999_960_360_000n, timestamp: 2 }, // 19999.6036
    ]
  );
  assert.equal(r.payouts[0].matched, true);
  assert.equal(r.payouts[0].amount_sat, 3_999_960_360_000n, "reports the exact burn sum");
  assert.equal(r.awaitingSat, 0n);
});

check("multi-recipient tx settles up to 5 burns in one payout", () => {
  const burns = [
    { amount_sat: 99_771_040_000n, timestamp: 1 }, // 997.7104
    { amount_sat: 62_765_090_000n, timestamp: 2 }, // 627.6509
    { amount_sat: 19_597_760_000n, timestamp: 3 }, // 195.9776
    { amount_sat: 100_000_000n, timestamp: 4 }, // 1.0
    { amount_sat: 200_000_000n, timestamp: 5 }, // 2.0
  ];
  const sum = burns.reduce((a, b) => a + b.amount_sat, 0n); // 1824.3389
  const r = matchPayoutsToBurns(
    [{ spend_tx_hash: "batch5", block_height: 2665, net_sat: sum + 100_000n, fee_sat: 300_000n }],
    burns
  );
  assert.equal(r.matchedBurnCount, 5);
  assert.equal(r.awaitingSat, 0n);
});

check("exact match wins the burn over a near-miss (stake vs real payout)", () => {
  // A real payout sends net 10000.0000 (== burn); a stakelock's net is
  // 10000.0041 (near but not equal). The exact-first pass must give the burn to
  // the real payout, leaving the stake unmatched — even though the stake is
  // processed first by block height.
  const r = matchPayoutsToBurns(
    [
      { spend_tx_hash: "stake", block_height: 102, net_sat: 1_000_000_410_000n, fee_sat: 600_000n },
      { spend_tx_hash: "payout", block_height: 3143, net_sat: 1_000_000_000_000n, fee_sat: 200_000n },
    ],
    [{ amount_sat: 1_000_000_000_000n, timestamp: 1 }]
  );
  const byTx = Object.fromEntries(r.payouts.map((p) => [p.spend_tx_hash, p]));
  assert.equal(byTx.payout.matched, true, "real payout claims the exact burn");
  assert.equal(byTx.stake.matched, false, "stakelock is left unmatched");
});

check("no clean settlement keeps net and leaves burns untouched", () => {
  // Payout net 100 (fee 5), but the only burn is 500 — cannot land in [100,105].
  const r = matchPayoutsToBurns(
    [{ spend_tx_hash: "x", block_height: 10, net_sat: 100n, fee_sat: 5n }],
    [{ amount_sat: 500n, timestamp: 1 }]
  );
  assert.equal(r.payouts[0].matched, false);
  assert.equal(r.payouts[0].amount_sat, 100n, "falls back to measured net");
  assert.equal(r.awaitingSat, 500n, "the unrelated burn is not consumed");
});

check("inconsistency: a payout with no matching burn is flagged, not counted as settled", () => {
  const r = matchPayoutsToBurns(
    [
      { spend_tx_hash: "real", block_height: 10, net_sat: 1000n, fee_sat: 5n },
      { spend_tx_hash: "phantom", block_height: 11, net_sat: 315n, fee_sat: 5n }, // no burn
    ],
    [{ amount_sat: 1000n, timestamp: 1 }]
  );
  assert.equal(r.settledSat, 1000n, "only the real payout counts as distributed");
  assert.equal(r.unmatchedPayoutSat, 315n, "the phantom outflow is flagged");
  assert.equal(r.unmatchedPayoutCount, 1);
  assert.equal(r.awaitingSat, 0n);
});

check("fully reconciled: settled == burned, nothing awaiting or unmatched", () => {
  const r = matchPayoutsToBurns(
    [
      { spend_tx_hash: "a", block_height: 10, net_sat: 500_000_000n, fee_sat: 1000n },
      { spend_tx_hash: "b", block_height: 11, net_sat: 100_000_000n, fee_sat: 1000n },
    ],
    [
      { amount_sat: 500_000_000n, timestamp: 1 },
      { amount_sat: 100_000_000n, timestamp: 2 },
    ]
  );
  assert.equal(r.settledSat, 600_000_000n);
  assert.equal(r.awaitingSat, 0n);
  assert.equal(r.unmatchedPayoutSat, 0n);
  assert.equal(r.unmatchedPayoutCount, 0);
});

check("empty inputs are safe", () => {
  const r = matchPayoutsToBurns([], []);
  assert.equal(r.payouts.length, 0);
  assert.equal(r.awaitingSat, 0n);
  assert.equal(r.matchedBurnCount, 0);
});

console.log(`\n${passed} checks passed`);
