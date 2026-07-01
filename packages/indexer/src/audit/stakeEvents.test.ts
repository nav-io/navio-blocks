/**
 * Lite test for the audit stake/unstake derivation + persistence.
 * Run: npm -w packages/indexer test   (tsx, no framework — throws on failure)
 */
import assert from "node:assert/strict";
import { deriveStakeEvents } from "./stakeEvents.js";
import { initDatabase } from "../db/schema.js";
import { Queries } from "../db/queries.js";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ok - ${name}`);
}

// --- deriveStakeEvents ------------------------------------------------------
check("stakelock outflow becomes a stake event and leaves the payout list", () => {
  const { events, excludeFromOutgoing } = deriveStakeEvents({
    spentByTx: new Map([
      // a stakelock: 10000 + fee left the wallet into a commitment
      ["stakeTx", { inputs: 1_000_000_412_250n, changeOut: 0n, block: 104 }],
      // an ordinary payout: not a stake tx
      ["payTx", { inputs: 4_242_600_000n, changeOut: 0n, block: 110 }],
    ]),
    receivedByTx: new Map(),
    stakeTxids: new Set(["stakeTx"]),
    unstakeTxids: new Set(),
  });
  assert.equal(events.length, 1);
  assert.equal(events[0].event_type, "stake");
  assert.equal(events[0].tx_hash, "stakeTx");
  assert.equal(events[0].amount_sat, "1000000412250");
  assert.equal(events[0].block_height, 104);
  assert.ok(excludeFromOutgoing.has("stakeTx"), "stake tx excluded from payouts");
  assert.ok(!excludeFromOutgoing.has("payTx"), "real payout kept");
});

check("stakeunlock inflow becomes an unstake event", () => {
  const { events, excludeFromOutgoing } = deriveStakeEvents({
    spentByTx: new Map(),
    receivedByTx: new Map([["unlockTx", { amount: 999_999_700_000n, block: 130 }]]),
    stakeTxids: new Set(),
    unstakeTxids: new Set(["unlockTx"]),
  });
  assert.equal(events.length, 1);
  assert.equal(events[0].event_type, "unstake");
  assert.equal(events[0].tx_hash, "unlockTx");
  assert.equal(events[0].amount_sat, "999999700000");
  assert.equal(excludeFromOutgoing.size, 0, "unstake is an inflow, not a payout");
});

check("non-stake flows produce nothing", () => {
  const { events } = deriveStakeEvents({
    spentByTx: new Map([["p", { inputs: 5n, changeOut: 1n, block: 1 }]]),
    receivedByTx: new Map([["r", { amount: 3n, block: 1 }]]),
    stakeTxids: new Set(),
    unstakeTxids: new Set(),
  });
  assert.equal(events.length, 0);
});

check("zero / negative net outflow is ignored", () => {
  const { events } = deriveStakeEvents({
    spentByTx: new Map([["s", { inputs: 10n, changeOut: 10n, block: 1 }]]),
    receivedByTx: new Map(),
    stakeTxids: new Set(["s"]),
    unstakeTxids: new Set(),
  });
  assert.equal(events.length, 0);
});

// --- queries: stake/unstake txid sets + persistence round-trip --------------
check("stakeTxids / unstakeTxids + replace/list round-trip", () => {
  const db = initDatabase(":memory:");
  const q = new Queries(db);

  const insOut = db.prepare(
    `INSERT INTO outputs (output_hash, txid, n, output_type) VALUES (?, ?, ?, ?)`
  );
  // stakelock stakeTx created stake output h_stake (vout 2)
  insOut.run("h_stake", "stakeTx", 2, "stake");
  insOut.run("h_change", "stakeTx", 0, "transfer");
  // unlockTx later spends h_stake
  const insIn = db.prepare(`INSERT INTO inputs (txid, vin, prev_out) VALUES (?, ?, ?)`);
  insIn.run("unlockTx", 0, "h_stake");

  assert.deepEqual([...q.stakeTxids()], ["stakeTx"]);
  assert.deepEqual([...q.unstakeTxids()], ["unlockTx"]);

  const meta = { balance_sat: "0", earned_rewards_sat: "0", synced_height: 5, chain_tip: 5, error_message: null, updated_at: 1 };
  const { events } = deriveStakeEvents({
    spentByTx: new Map([["stakeTx", { inputs: 1_000_000_412_250n, changeOut: 0n, block: 104 }]]),
    receivedByTx: new Map([["unlockTx", { amount: 999_999_700_000n, block: 130 }]]),
    stakeTxids: q.stakeTxids(),
    unstakeTxids: q.unstakeTxids(),
  });
  assert.equal(events.length, 2);
  q.replaceNavioAuditData(meta, [], events);

  const listed = q.listNavioAuditStakeEvents(50, 0);
  assert.equal(listed.length, 2);
  assert.equal(q.countNavioAuditStakeEvents(), 2);
  assert.equal(listed[0].event_type, "unstake"); // higher block first
  assert.equal(listed[1].event_type, "stake");

  q.replaceNavioAuditData(meta, [], []);
  assert.equal(q.countNavioAuditStakeEvents(), 0);
  db.close();
});

console.log(`\n${passed} checks passed`);
