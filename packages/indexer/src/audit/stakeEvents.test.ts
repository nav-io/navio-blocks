/**
 * Lite test for the audit stake/unstake derivation + persistence.
 * Run: npm -w packages/indexer test   (tsx, no framework — throws on failure)
 */
import assert from "node:assert/strict";
import { deriveStakeEvents, type OwnedOutputLite } from "./stakeEvents.js";
import { initDatabase } from "../db/schema.js";
import { Queries } from "../db/queries.js";

function out(p: Partial<OwnedOutputLite> & { txHash: string; outputIndex: number }): OwnedOutputLite {
  return {
    blockHeight: 100,
    amount: 10_000n,
    tokenId: null,
    isSpent: false,
    spentTxHash: null,
    spentBlockHeight: null,
    ...p,
  };
}

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ok - ${name}`);
}

// --- deriveStakeEvents ------------------------------------------------------
const stakeKeys = new Set(["t1:0", "t2:0", "c1:0", "c2:0"]);

check("two separate stakes + one genuine unstake", () => {
  const events = deriveStakeEvents(
    [
      out({ txHash: "t1", outputIndex: 0, blockHeight: 102 }),
      out({ txHash: "t2", outputIndex: 0, blockHeight: 103, isSpent: true, spentTxHash: "u1", spentBlockHeight: 120 }),
    ],
    stakeKeys
  );
  const stakes = events.filter((e) => e.event_type === "stake");
  const unstakes = events.filter((e) => e.event_type === "unstake");
  assert.equal(stakes.length, 2, "two stake events");
  assert.equal(unstakes.length, 1, "one unstake event");
  assert.equal(unstakes[0].tx_hash, "u1");
  assert.equal(unstakes[0].amount_sat, "10000");
  assert.equal(unstakes[0].block_height, 120);
});

check("consolidation / re-stake is NOT an unstake", () => {
  // c1 spent by c2, and c2 itself creates a new owned stake -> re-stake.
  const events = deriveStakeEvents(
    [
      out({ txHash: "c1", outputIndex: 0, isSpent: true, spentTxHash: "c2", spentBlockHeight: 130 }),
      out({ txHash: "c2", outputIndex: 0, amount: 20_000n }),
    ],
    stakeKeys
  );
  assert.equal(events.filter((e) => e.event_type === "unstake").length, 0, "no unstake on re-stake");
  assert.equal(events.filter((e) => e.event_type === "stake").length, 2, "two stake events");
});

check("token + non-stake outputs are ignored", () => {
  const events = deriveStakeEvents(
    [
      out({ txHash: "t1", outputIndex: 0, tokenId: "deadbeef" }), // token: ignored even though key matches
      out({ txHash: "zz", outputIndex: 9 }), // not in stakeKeys: ignored
    ],
    stakeKeys
  );
  assert.equal(events.length, 0);
});

check("amounts from same tx are summed", () => {
  const keys = new Set(["m1:0", "m1:1"]);
  const events = deriveStakeEvents(
    [
      out({ txHash: "m1", outputIndex: 0, amount: 10_000n }),
      out({ txHash: "m1", outputIndex: 1, amount: 5_000n }),
    ],
    keys
  );
  assert.equal(events.length, 1);
  assert.equal(events[0].amount_sat, "15000");
});

// --- queries persistence round-trip ----------------------------------------
check("stakeOutputKeys + replace/list round-trip", () => {
  const db = initDatabase(":memory:");
  const q = new Queries(db);

  const insOut = db.prepare(
    `INSERT INTO outputs (output_hash, txid, n, output_type) VALUES (?, ?, ?, ?)`
  );
  insOut.run("h1", "t1", 0, "stake");
  insOut.run("h2", "t2", 0, "stake");
  insOut.run("h3", "t3", 0, "transfer");

  const keys = q.stakeOutputKeys();
  assert.ok(keys.has("t1:0") && keys.has("t2:0"));
  assert.ok(!keys.has("t3:0"), "non-stake output excluded");

  const meta = {
    balance_sat: "0",
    synced_height: 5,
    chain_tip: 5,
    error_message: null,
    updated_at: 1,
  };
  const stakeEvents = deriveStakeEvents(
    [out({ txHash: "t1", outputIndex: 0, blockHeight: 102 })],
    keys
  );
  q.replaceNavioAuditData(meta, [], stakeEvents);

  const listed = q.listNavioAuditStakeEvents(50, 0);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].event_type, "stake");
  assert.equal(listed[0].tx_hash, "t1");
  assert.equal(q.countNavioAuditStakeEvents(), 1);

  // Replacing with an empty set clears prior rows.
  q.replaceNavioAuditData(meta, [], []);
  assert.equal(q.countNavioAuditStakeEvents(), 0);
  db.close();
});

console.log(`\n${passed} checks passed`);
