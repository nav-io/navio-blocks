import type { RpcClient } from "../rpc/client.js";
import type { Queries } from "../db/queries.js";

/**
 * Detect and handle a chain reorganization.
 *
 * Walks backwards from syncHeight comparing the local DB block hash to the
 * RPC block hash at the same height.  When a mismatch is found the block
 * (and its transactions, outputs, inputs) are removed from the DB.  Returns
 * the height of the last block that still matches (the common ancestor), or
 * syncHeight if no reorg occurred.
 */
export async function detectReorg(
  rpc: RpcClient,
  queries: Queries,
  syncHeight: number
): Promise<number> {
  let height = syncHeight;

  while (height > 0) {
    const localBlock = queries.getBlockByHeight(height);
    if (!localBlock) {
      // Block missing locally — treat as needing re-sync from here
      height--;
      continue;
    }

    const rpcHash = await rpc.getBlockHash(height);

    if (localBlock.hash === rpcHash) {
      // Found common ancestor
      break;
    }

    // Mismatch — remove the orphaned block
    console.log(
      `[reorg] Block ${height} mismatch: local=${localBlock.hash.slice(0, 16)}... rpc=${rpcHash.slice(0, 16)}... — removing`
    );
    queries.deleteBlockAndRelated(height);
    height--;
  }

  if (height < syncHeight) {
    console.log(
      `[reorg] Reorganization detected: rolled back from ${syncHeight} to ${height}`
    );
    queries.setSyncHeight(height);
  }

  return height;
}
