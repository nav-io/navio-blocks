import type { NetworkType } from "@navio-blocks/shared";
import type { RpcClient } from "../rpc/client.js";
import type { Queries } from "../db/queries.js";
import { parseBlock } from "./block.js";
import { detectReorg } from "./reorg.js";

export class Poller {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    private rpc: RpcClient,
    private queries: Queries,
    private network: NetworkType = 'mainnet'
  ) {}

  private isMoneyRangeBug(err: unknown): boolean {
    const msg = err instanceof Error ? err.message : String(err);
    return msg.includes("MoneyRange(fee)");
  }

  private async fetchBlockWithFallback(
    hash: string,
    height: number
  ): Promise<Record<string, unknown>> {
    try {
      return (await this.rpc.getBlock(hash, 2)) as Record<string, unknown>;
    } catch (err) {
      if (!this.isMoneyRangeBug(err)) throw err;

      console.warn(
        `[sync] getblock verbosity=2 failed at height ${height} (${hash.slice(0, 16)}...) due MoneyRange(fee); retrying with tx hydration`
      );

      const basicBlock = (await this.rpc.getBlock(hash, 1)) as Record<
        string,
        unknown
      >;
      const rawTxIds = basicBlock.tx;
      if (!Array.isArray(rawTxIds)) {
        throw new Error(
          `Invalid tx list from getblock verbosity=1 at height ${height}`
        );
      }

      const txids = rawTxIds.filter((txid): txid is string => typeof txid === "string");
      if (txids.length !== rawTxIds.length) {
        throw new Error(
          `Non-string tx id found in getblock verbosity=1 response at height ${height}`
        );
      }

      const hydratedTxs: Record<string, unknown>[] = [];
      for (const txid of txids) {
        try {
          const tx = (await this.rpc.getRawTransaction(
            txid,
            true
          )) as Record<string, unknown>;
          hydratedTxs.push(tx);
        } catch (txErr) {
          if (!this.isMoneyRangeBug(txErr)) {
            const txMsg = txErr instanceof Error ? txErr.message : String(txErr);
            throw new Error(
              `Failed to hydrate tx ${txid} for block ${height}: ${txMsg}`
            );
          }

          console.warn(
            `[sync] getrawtransaction verbose=true failed for tx ${txid} at height ${height}; retrying with decoderawtransaction`
          );

          const rawTx = await this.rpc.getRawTransaction(txid, false);
          if (typeof rawTx !== "string") {
            throw new Error(
              `Invalid raw tx payload for tx ${txid} at height ${height}`
            );
          }

          const decodedTx = (await this.rpc.decodeRawTransaction(
            rawTx
          )) as Record<string, unknown>;
          hydratedTxs.push(decodedTx);
        }
      }

      return {
        ...basicBlock,
        tx: hydratedTxs,
      };
    }
  }

  async sync(): Promise<void> {
    if (this.running) return;
    this.running = true;

    try {
      let syncHeight = this.queries.getSyncHeight() ?? -1;

      // Check for reorgs if we have synced at least one block
      if (syncHeight >= 0) {
        syncHeight = await detectReorg(this.rpc, this.queries, syncHeight);
      }

      const chainHeight = await this.rpc.getBlockCount();

      if (syncHeight >= chainHeight) {
        return;
      }

      const startHeight = syncHeight + 1;
      console.log(
        `[sync] Syncing blocks ${startHeight} to ${chainHeight} (${chainHeight - syncHeight} blocks)`
      );

      for (let h = startHeight; h <= chainHeight; h++) {
        const hash = await this.rpc.getBlockHash(h);
        const rpcBlock = await this.fetchBlockWithFallback(hash, h);
        const { block, transactions, outputs, inputs, fees } = parseBlock(rpcBlock, this.network);

        this.queries.insertBlockBatch(block, transactions, outputs, inputs);

        // Compute and insert supply data
        const prevSupply = h > 0
          ? (this.queries.getBlockSupply(h - 1)?.total_supply ?? 0)
          : 0;
        const totalSupply = prevSupply + fees.block_reward - fees.fees_burned;
        this.queries.insertBlockSupply({
          height: h,
          block_reward: fees.block_reward,
          fees_burned: fees.fees_burned,
          fees_collected: fees.fees_collected,
          total_supply: totalSupply,
        });

        this.queries.setSyncHeight(h);

        if ((h - startHeight) % 100 === 0 && h !== startHeight) {
          const pct = (((h - startHeight) / (chainHeight - syncHeight)) * 100).toFixed(1);
          console.log(
            `[sync] Progress: block ${h} / ${chainHeight} (${pct}%)`
          );
        }
      }

      console.log(`[sync] Sync complete at block ${chainHeight}`);
    } catch (err) {
      console.error("[sync] Error during sync:", err);
    } finally {
      this.running = false;
    }
  }

  start(intervalMs = 5000): void {
    console.log(`[sync] Starting poller with ${intervalMs}ms interval`);
    // Run immediately
    void this.sync();
    this.timer = setInterval(() => void this.sync(), intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      console.log("[sync] Poller stopped");
    }
  }
}
