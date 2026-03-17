import type { Block, Transaction, Output, Input, NetworkType } from "@navio-blocks/shared";
import { getExpectedBlockReward } from "./supply.js";

interface BlockFees {
  block_reward: number;   // new coins minted (subsidy/fixed reward) in satoshis
  fees_burned: number;    // fees burned via OP_RETURN in BLSCT txs, in satoshis
  fees_collected: number; // fees collected by miner in PoW blocks, in satoshis
}

interface ParsedBlock {
  block: Block;
  transactions: Transaction[];
  outputs: Output[];
  inputs: Input[];
  fees: BlockFees;
}

function isBlsctOutput(vout: Record<string, unknown>): boolean {
  if (vout.rangeproof) return true;
  if (vout.spending_key) return true;
  if (vout.ephemeral_key) return true;
  if (vout.blinding_key) return true;
  if (vout.view_tag) return true;

  const spk = vout.scriptPubKey as Record<string, unknown> | undefined;
  if (spk) {
    if (spk.spending_key) return true;
    if (spk.ephemeral_key) return true;
    if (spk.blinding_key) return true;
    if (spk.view_tag) return true;
    const type = spk.type as string | undefined;
    if (type === "blsct") return true;
  }
  return false;
}

function hasTokenFields(vout: Record<string, unknown>): boolean {
  if (vout.token || vout.tokenId || vout.token_id) return true;
  const spk = vout.scriptPubKey as Record<string, unknown> | undefined;
  if (spk && (spk.token || spk.tokenId || spk.token_id)) return true;
  return false;
}

function extractBlsctFields(vout: Record<string, unknown>): {
  spending_key?: string;
  ephemeral_key?: string;
  blinding_key?: string;
  view_tag?: string;
} {
  const spk = vout.scriptPubKey as Record<string, unknown> | undefined;
  return {
    spending_key:
      (vout.spending_key as string) ?? (spk?.spending_key as string) ?? undefined,
    ephemeral_key:
      (vout.ephemeral_key as string) ?? (spk?.ephemeral_key as string) ?? undefined,
    blinding_key:
      (vout.blinding_key as string) ?? (spk?.blinding_key as string) ?? undefined,
    view_tag:
      (vout.view_tag as string) ?? (spk?.view_tag as string) ?? undefined,
  };
}

function extractAddress(vout: Record<string, unknown>): string | undefined {
  const spk = vout.scriptPubKey as Record<string, unknown> | undefined;
  if (!spk) return undefined;

  if (typeof spk.address === "string") return spk.address;

  const addresses = spk.addresses as string[] | undefined;
  if (addresses && addresses.length > 0) return addresses[0];

  return undefined;
}

function satoshis(btcValue: unknown): number {
  if (typeof btcValue === "number") {
    return Math.round(btcValue * 1e8);
  }
  return 0;
}

function toRawJson(value: unknown): string | null {
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function extractPrevOutFromVin(vin: Record<string, unknown>): string {
  const directCandidates: unknown[] = [
    vin.outid,
    vin.outId,
    vin.out_id,
    vin.output_hash,
    vin.outpoint,
    vin.prev_out,
    vin.prevout,
    vin.hash,
  ];

  for (const candidate of directCandidates) {
    if (typeof candidate === "string" && candidate.length > 0) {
      return candidate;
    }
  }

  const outpointObj = vin.outpoint as Record<string, unknown> | undefined;
  const prevoutObj = vin.prevout as Record<string, unknown> | undefined;
  const nestedCandidates: unknown[] = [
    outpointObj?.output_hash,
    outpointObj?.hash,
    prevoutObj?.output_hash,
    prevoutObj?.hash,
    prevoutObj?.outpoint,
  ];
  for (const candidate of nestedCandidates) {
    if (typeof candidate === "string" && candidate.length > 0) {
      return candidate;
    }
  }

  return "";
}

export function computeBlockFees(
  rpcBlock: Record<string, unknown>,
  network: NetworkType,
  isBlsct: boolean
): BlockFees {
  const height = rpcBlock.height as number;
  const txs = (rpcBlock.tx as Record<string, unknown>[]) ?? [];
  const blockReward = getExpectedBlockReward(height, network, isBlsct);

  // Calculate coinbase total output value
  let coinbaseValue = 0;
  if (txs.length > 0) {
    const coinbaseTx = txs[0];
    const coinbaseVouts = (coinbaseTx.vout as Record<string, unknown>[]) ?? [];
    for (const vout of coinbaseVouts) {
      coinbaseValue += satoshis(vout.value);
    }
  }

  // fees_collected: for PoW blocks, coinbase value minus subsidy = miner fees
  // For BLSCT/PoS blocks, coinbase only gets the fixed reward, no fees
  let feesCollected = 0;
  if (!isBlsct && coinbaseValue > blockReward) {
    feesCollected = coinbaseValue - blockReward;
  }

  // fees_burned: sum of fee outputs (nulldata/fee type with value > 0) in non-coinbase txs
  let feesBurned = 0;
  for (let i = 1; i < txs.length; i++) {
    const tx = txs[i];
    // Check if the tx has a direct 'fee' field (some RPC responses include this)
    if (typeof tx.fee === 'number' && tx.fee > 0) {
      // Only count as burned if this is a BLSCT block where fees are burned
      if (isBlsct) {
        feesBurned += satoshis(tx.fee);
        continue;
      }
    }

    const vouts = (tx.vout as Record<string, unknown>[]) ?? [];
    for (const vout of vouts) {
      const spk = vout.scriptPubKey as Record<string, unknown> | undefined;
      if (!spk) continue;
      const spkType = spk.type as string | undefined;
      const val = satoshis(vout.value);
      if (val > 0 && (spkType === 'nulldata' || spkType === 'fee')) {
        feesBurned += val;
      }
    }
  }

  return {
    block_reward: blockReward,
    fees_burned: feesBurned,
    fees_collected: feesCollected,
  };
}

export function parseBlock(rpcBlock: Record<string, unknown>, network: NetworkType = 'mainnet'): ParsedBlock {
  const txs = (rpcBlock.tx as Record<string, unknown>[]) ?? [];
  const blockVersion = rpcBlock.version as number;

  // Detect block type via version bits (from navio-core primitives/block.h)
  // VERSION_BIT_POS   = 0x01000000  →  block.IsProofOfStake()
  // VERSION_BIT_BLSCT = 0x40000000  →  block.IsBLSCT()
  const isPos = (blockVersion & 0x01000000) !== 0;
  const isBlsct = (blockVersion & 0x40000000) !== 0;

  const block: Block = {
    height: rpcBlock.height as number,
    hash: rpcBlock.hash as string,
    prev_hash: (rpcBlock.previousblockhash as string) ?? "",
    timestamp: rpcBlock.time as number,
    version: rpcBlock.version as number,
    merkle_root: rpcBlock.merkleroot as string,
    bits: rpcBlock.bits as string,
    nonce: rpcBlock.nonce as number,
    difficulty: rpcBlock.difficulty as number,
    size: rpcBlock.size as number,
    weight: rpcBlock.weight as number,
    tx_count: txs.length,
    is_pos: isPos,
    is_blsct: isBlsct,
    chainwork: (rpcBlock.chainwork as string) ?? "",
  };

  const transactions: Transaction[] = [];
  const outputs: Output[] = [];
  const inputs: Input[] = [];

  for (let txIndex = 0; txIndex < txs.length; txIndex++) {
    const rpcTx = txs[txIndex];
    const vins = (rpcTx.vin as Record<string, unknown>[]) ?? [];
    const vouts = (rpcTx.vout as Record<string, unknown>[]) ?? [];

    const isCoinbaseTx =
      vins.length > 0 && vins[0].coinbase !== undefined;

    let txIsBlsct = false;
    let txHasToken = false;

    // Parse outputs
    // Navio uses a single output hash as the outpoint identifier
    for (const rpcVout of vouts) {
      const voutIndex = rpcVout.n as number;
      // The output hash is the unique outpoint identifier in Navio
      const outputHash = (rpcVout.output_hash as string) ?? (rpcVout.outputhash as string) ?? (rpcVout.hash as string) ?? "";
      const blsct = isBlsctOutput(rpcVout);
      if (blsct) txIsBlsct = true;
      if (hasTokenFields(rpcVout)) txHasToken = true;

      if (blsct) {
        const fields = extractBlsctFields(rpcVout);
        outputs.push({
          txid: rpcTx.txid as string,
          n: voutIndex,
          output_hash: outputHash,
          is_blsct: true,
          spending_key: fields.spending_key,
          ephemeral_key: fields.ephemeral_key,
          blinding_key: fields.blinding_key,
          view_tag: fields.view_tag,
        });
      } else {
        outputs.push({
          txid: rpcTx.txid as string,
          n: voutIndex,
          output_hash: outputHash,
          value_sat: satoshis(rpcVout.value),
          address: extractAddress(rpcVout),
          is_blsct: false,
        });
      }
    }

    // Parse inputs
    // Navio references previous outputs by a single outpoint hash (not txid:vout)
    for (let vinIndex = 0; vinIndex < vins.length; vinIndex++) {
      const rpcVin = vins[vinIndex];
      const isCoinbaseInput = rpcVin.coinbase !== undefined;
      // prev_out is the output hash of the spent outpoint
      const prevOut = isCoinbaseInput ? "" : extractPrevOutFromVin(rpcVin);

      inputs.push({
        txid: rpcTx.txid as string,
        vin: vinIndex,
        prev_out: prevOut,
        is_coinbase: isCoinbaseInput,
      });
    }

    transactions.push({
      txid: rpcTx.txid as string,
      block_height: block.height,
      tx_index: txIndex,
      version: (rpcTx.version as number) ?? 0,
      size: (rpcTx.size as number) ?? 0,
      vsize: (rpcTx.vsize as number) ?? 0,
      locktime: (rpcTx.locktime as number) ?? 0,
      is_coinbase: isCoinbaseTx,
      is_blsct: txIsBlsct,
      input_count: vins.length,
      output_count: vouts.length,
      has_token: txHasToken,
      raw_json: toRawJson(rpcTx),
    });
  }

  const fees = computeBlockFees(rpcBlock, network, isBlsct);

  block.block_reward = fees.block_reward;
  block.fees_burned = fees.fees_burned;
  block.fees_collected = fees.fees_collected;

  return { block, transactions, outputs, inputs, fees };
}
