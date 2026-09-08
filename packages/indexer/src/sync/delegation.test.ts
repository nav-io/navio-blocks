import assert from "node:assert/strict";
import { isDelegationPredicateHex, isDelegationPayload } from "./block.js";

// Real mainnet delegated stake (output fe3c7f42…, height 45867): op 04, compact
// size fd fd01 (=509 bytes), then magic "NVDG" + version 01.
const MAINNET_DELEGATION_PREFIX = "04fdfd014e564447018657affdea161cb5816ba8f5d5d86148251b0056f0759a897b04e4919e4b56365e466fe9e2748c8ce63237be1e673311e70037bcaba7cd5f6ee49d016f81884ef9ac92eb06bcce0c585ce6afc5dfe062e0c75579c53c533f2e42cda584bab33d7607f30b0588d45751317a9ac82fd7ba171404a5e7b2c2c27ad221f445c9c468fdf0361279ea3b48c6286b875a21acbe00b27966b72381827f1ca425f30f818372f8ab8d22ba9f7a4c57777318724d2cbc9a53474bcfc14c9c81c23306a37e192ccbb2e6342de4b67f5c6297117780b4a278df7ceef30749a7f1dd7c681350469ff9b1145d2c8e55739f5739fe649ec3fb0b6d6ee2b90e48735981aec0a3c25d0c59553946f578330247b082bff5d49f9e304d3472372aaf0a18b94a8f2fe222346a511cb10a24228f6d508dacd857adade2a7652123bed8442e63bcca8b5616b2394eb48c8990ff7a985f9410899ed8ebd6f1626bcc3f794781124bb6a0f041e61b8b7362536204fa1c9e273b6742aa6167346c4d7ee0d8529a4d7d32a1aa824ce2e07476da5d5e38fc694fe0a6993c2d54271aeb2ecc84c8ca13c8c30240ee8626991dc2d375e768512bd4e163ba3067e1a79cba5b124a84a5804b8675603503ea69b0d11a4bfc1c73f04eb15520d72a3615889d7ddc110e459c5dfedf92467327b316515c616b03edcfb023eb4626421a3376565e7081";

assert.equal(isDelegationPredicateHex(MAINNET_DELEGATION_PREFIX), true, "3-byte compact size");
assert.equal(isDelegationPredicateHex("04" + "40" + "4e56444701" + "ab".repeat(60)), true, "1-byte compact size");
assert.equal(isDelegationPredicateHex("04" + "fe00010000" + "4e56444701" + "ab".repeat(60)), true, "5-byte compact size");
assert.equal(isDelegationPredicateHex("04" + "05" + "68656c6c6f"), false, "plain DATA payload");
assert.equal(isDelegationPredicateHex("03" + "4e56444701"), false, "PAY_FEE op");
assert.equal(isDelegationPredicateHex(""), false);
assert.equal(isDelegationPredicateHex(undefined), false);

const payload = Buffer.from("4e56444701" + "00".repeat(200), "hex");
assert.equal(isDelegationPayload(payload), true);
assert.equal(isDelegationPayload(Buffer.from("4e56444701", "hex")), false, "magic alone is too short");
assert.equal(isDelegationPayload(Buffer.from("4e56444702" + "00".repeat(200), "hex")), false, "unknown version");

console.log("delegation.test.ts passed");
