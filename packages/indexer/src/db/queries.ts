import type Database from "better-sqlite3";
import type {
  Block,
  BlockSupply,
  Transaction,
  Output,
  Input,
  Peer,
  PriceHistoryPoint,
} from "@navio-blocks/shared";

export class Queries {
  private stmtInsertBlock;
  private stmtInsertTx;
  private stmtInsertOutput;
  private stmtInsertInput;
  private stmtGetSyncHeight;
  private stmtSetSyncHeight;
  private stmtGetBlockByHeight;
  private stmtGetBlockByHash;
  private stmtDeleteBlock;
  private stmtDeleteTxsByBlock;
  private stmtDeleteOutputsByBlock;
  private stmtDeleteInputsByBlock;
  private stmtUpsertPeer;
  private stmtGetPeerByAddr;
  private stmtUpdatePeerById;
  private stmtDedupePeersByAddr;
  private stmtDeleteOldPeers;
  private stmtInsertPrice;
  private stmtGetLatestPriceTs;
  private stmtGetEarliestPriceTs;
  private stmtGetPriceCount;
  private stmtInsertBlockSupply;
  private stmtGetBlockSupply;
  private stmtGetLatestSupply;
  private stmtGetTotalBurned;
  private stmtDeleteBlockSupply;

  constructor(private db: Database.Database) {
    this.stmtInsertBlock = db.prepare(`
      INSERT OR REPLACE INTO blocks
        (height, hash, prev_hash, timestamp, version, merkle_root, bits, nonce, difficulty, size, weight, tx_count, is_pos, is_blsct, chainwork)
      VALUES
        (@height, @hash, @prev_hash, @timestamp, @version, @merkle_root, @bits, @nonce, @difficulty, @size, @weight, @tx_count, @is_pos, @is_blsct, @chainwork)
    `);

    this.stmtInsertTx = db.prepare(`
      INSERT OR REPLACE INTO transactions
        (txid, block_height, tx_index, version, size, vsize, locktime, is_coinbase, is_blsct, input_count, output_count, has_token, raw_json)
      VALUES
        (@txid, @block_height, @tx_index, @version, @size, @vsize, @locktime, @is_coinbase, @is_blsct, @input_count, @output_count, @has_token, @raw_json)
    `);

    this.stmtInsertOutput = db.prepare(`
      INSERT OR REPLACE INTO outputs
        (output_hash, txid, n, value_sat, address, spending_key, ephemeral_key, blinding_key, view_tag, is_blsct, output_type, spk_type, spk_hex, token_id)
      VALUES
        (@output_hash, @txid, @n, @value_sat, @address, @spending_key, @ephemeral_key, @blinding_key, @view_tag, @is_blsct, @output_type, @spk_type, @spk_hex, @token_id)
    `);

    this.stmtInsertInput = db.prepare(`
      INSERT OR REPLACE INTO inputs
        (txid, vin, prev_out, is_coinbase)
      VALUES
        (@txid, @vin, @prev_out, @is_coinbase)
    `);

    this.stmtGetSyncHeight = db.prepare(
      `SELECT value FROM sync_state WHERE key = 'sync_height'`
    );

    this.stmtSetSyncHeight = db.prepare(`
      INSERT OR REPLACE INTO sync_state (key, value) VALUES ('sync_height', @value)
    `);

    this.stmtGetBlockByHeight = db.prepare(
      `SELECT * FROM blocks WHERE height = ?`
    );

    this.stmtGetBlockByHash = db.prepare(
      `SELECT * FROM blocks WHERE hash = ?`
    );

    this.stmtDeleteBlock = db.prepare(`DELETE FROM blocks WHERE height = ?`);

    this.stmtDeleteTxsByBlock = db.prepare(
      `DELETE FROM transactions WHERE block_height = ?`
    );

    this.stmtDeleteOutputsByBlock = db.prepare(`
      DELETE FROM outputs WHERE txid IN (
        SELECT txid FROM transactions WHERE block_height = ?
      )
    `);

    this.stmtDeleteInputsByBlock = db.prepare(`
      DELETE FROM inputs WHERE txid IN (
        SELECT txid FROM transactions WHERE block_height = ?
      )
    `);

    this.stmtUpsertPeer = db.prepare(`
      INSERT OR REPLACE INTO peers
        (id, addr, subversion, services, country, city, lat, lon, last_seen, first_seen)
      VALUES
        (@id, @addr, @subversion, @services, @country, @city, @lat, @lon, @last_seen, @first_seen)
    `);

    this.stmtGetPeerByAddr = db.prepare(
      `SELECT id, first_seen
       FROM peers
       WHERE addr = ?
       ORDER BY last_seen DESC, id DESC
       LIMIT 1`
    );

    this.stmtUpdatePeerById = db.prepare(`
      UPDATE peers
      SET
        addr = @addr,
        subversion = @subversion,
        services = @services,
        country = @country,
        city = @city,
        lat = @lat,
        lon = @lon,
        last_seen = @last_seen,
        first_seen = @first_seen
      WHERE id = @id
    `);

    this.stmtDedupePeersByAddr = db.prepare(`
      DELETE FROM peers
      WHERE rowid NOT IN (
        SELECT MAX(rowid)
        FROM peers
        GROUP BY addr
      )
    `);

    this.stmtDeleteOldPeers = db.prepare(
      `DELETE FROM peers WHERE last_seen < ?`
    );

    this.stmtInsertPrice = db.prepare(`
      INSERT OR REPLACE INTO price_history
        (timestamp, price_usd, price_btc, volume_24h, market_cap)
      VALUES
        (@timestamp, @price_usd, @price_btc, @volume_24h, @market_cap)
    `);

    this.stmtGetLatestPriceTs = db.prepare(
      `SELECT timestamp FROM price_history ORDER BY timestamp DESC LIMIT 1`
    );

    this.stmtGetEarliestPriceTs = db.prepare(
      `SELECT timestamp FROM price_history ORDER BY timestamp ASC LIMIT 1`
    );

    this.stmtGetPriceCount = db.prepare(
      `SELECT COUNT(*) AS count FROM price_history`
    );

    this.stmtInsertBlockSupply = db.prepare(`
      INSERT OR REPLACE INTO block_supply
        (height, block_reward, fees_burned, fees_collected, total_supply)
      VALUES
        (@height, @block_reward, @fees_burned, @fees_collected, @total_supply)
    `);

    this.stmtGetBlockSupply = db.prepare(
      `SELECT * FROM block_supply WHERE height = ?`
    );

    this.stmtGetLatestSupply = db.prepare(
      `SELECT * FROM block_supply ORDER BY height DESC LIMIT 1`
    );

    this.stmtGetTotalBurned = db.prepare(
      `SELECT COALESCE(SUM(fees_burned), 0) AS total_burned FROM block_supply`
    );

    this.stmtDeleteBlockSupply = db.prepare(
      `DELETE FROM block_supply WHERE height = ?`
    );
  }

  insertBlock(block: Block): void {
    this.stmtInsertBlock.run({
      height: block.height,
      hash: block.hash,
      prev_hash: block.prev_hash,
      timestamp: block.timestamp,
      version: block.version,
      merkle_root: block.merkle_root,
      bits: block.bits,
      nonce: block.nonce,
      difficulty: block.difficulty,
      size: block.size,
      weight: block.weight,
      tx_count: block.tx_count,
      is_pos: block.is_pos ? 1 : 0,
      is_blsct: block.is_blsct ? 1 : 0,
      chainwork: block.chainwork,
    });
  }

  insertTransaction(tx: Transaction): void {
    this.stmtInsertTx.run({
      txid: tx.txid,
      block_height: tx.block_height,
      tx_index: tx.tx_index,
      version: tx.version,
      size: tx.size,
      vsize: tx.vsize,
      locktime: tx.locktime,
      is_coinbase: tx.is_coinbase ? 1 : 0,
      is_blsct: tx.is_blsct ? 1 : 0,
      input_count: tx.input_count,
      output_count: tx.output_count,
      has_token: tx.has_token ? 1 : 0,
      raw_json: tx.raw_json ?? null,
    });
  }

  insertOutput(output: Output): void {
    this.stmtInsertOutput.run({
      output_hash: output.output_hash,
      txid: output.txid,
      n: output.n,
      value_sat: output.value_sat ?? null,
      address: output.address ?? null,
      spending_key: output.spending_key ?? null,
      ephemeral_key: output.ephemeral_key ?? null,
      blinding_key: output.blinding_key ?? null,
      view_tag: output.view_tag ?? null,
      is_blsct: output.is_blsct ? 1 : 0,
      output_type: output.output_type ?? 'unknown',
      spk_type: output.spk_type ?? null,
      spk_hex: output.spk_hex ?? null,
      token_id: output.token_id ?? null,
    });
  }

  insertInput(input: Input): void {
    this.stmtInsertInput.run({
      txid: input.txid,
      vin: input.vin,
      prev_out: input.prev_out,
      is_coinbase: input.is_coinbase ? 1 : 0,
    });
  }

  getSyncHeight(): number | null {
    const row = this.stmtGetSyncHeight.get() as
      | { value: string }
      | undefined;
    if (!row) return null;
    const parsed = parseInt(row.value, 10);
    return Number.isNaN(parsed) ? null : parsed;
  }

  setSyncHeight(height: number): void {
    this.stmtSetSyncHeight.run({ value: String(height) });
  }

  getBlockByHeight(height: number): Block | undefined {
    const row = this.stmtGetBlockByHeight.get(height) as
      | Record<string, unknown>
      | undefined;
    return row ? this.rowToBlock(row) : undefined;
  }

  getBlockByHash(hash: string): Block | undefined {
    const row = this.stmtGetBlockByHash.get(hash) as
      | Record<string, unknown>
      | undefined;
    return row ? this.rowToBlock(row) : undefined;
  }

  deleteBlockAndRelated(height: number): void {
    const deleteAll = this.db.transaction((h: number) => {
      this.stmtDeleteOutputsByBlock.run(h);
      this.stmtDeleteInputsByBlock.run(h);
      this.stmtDeleteTxsByBlock.run(h);
      this.stmtDeleteBlockSupply.run(h);
      this.stmtDeleteBlock.run(h);
    });
    deleteAll(height);
  }

  upsertPeer(peer: Peer): void {
    const existing = this.stmtGetPeerByAddr.get(peer.addr) as
      | { id: number; first_seen: number }
      | undefined;

    if (existing) {
      const firstSeen =
        Number.isFinite(existing.first_seen) && existing.first_seen > 0
          ? Math.min(existing.first_seen, peer.first_seen)
          : peer.first_seen;

      this.stmtUpdatePeerById.run({
        id: existing.id,
        addr: peer.addr,
        subversion: peer.subversion,
        services: peer.services,
        country: peer.country ?? null,
        city: peer.city ?? null,
        lat: peer.lat ?? null,
        lon: peer.lon ?? null,
        last_seen: peer.last_seen,
        first_seen: firstSeen,
      });
      return;
    }

    this.stmtUpsertPeer.run({
      id: peer.id,
      addr: peer.addr,
      subversion: peer.subversion,
      services: peer.services,
      country: peer.country ?? null,
      city: peer.city ?? null,
      lat: peer.lat ?? null,
      lon: peer.lon ?? null,
      last_seen: peer.last_seen,
      first_seen: peer.first_seen,
    });
  }

  compactPeersByAddress(): void {
    this.stmtDedupePeersByAddr.run();
  }

  deleteOldPeers(cutoff: number): void {
    this.stmtDeleteOldPeers.run(cutoff);
  }

  insertPricePoint(point: PriceHistoryPoint): void {
    this.stmtInsertPrice.run({
      timestamp: point.timestamp,
      price_usd: point.price_usd,
      price_btc: point.price_btc,
      volume_24h: point.volume_24h,
      market_cap: point.market_cap,
    });
  }

  getLatestPriceTimestamp(): number | null {
    const row = this.stmtGetLatestPriceTs.get() as
      | { timestamp: number }
      | undefined;
    return row?.timestamp ?? null;
  }

  getEarliestPriceTimestamp(): number | null {
    const row = this.stmtGetEarliestPriceTs.get() as
      | { timestamp: number }
      | undefined;
    return row?.timestamp ?? null;
  }

  getPriceCount(): number {
    const row = this.stmtGetPriceCount.get() as { count: number };
    return row.count;
  }

  insertBlockSupply(data: BlockSupply): void {
    this.stmtInsertBlockSupply.run({
      height: data.height,
      block_reward: data.block_reward,
      fees_burned: data.fees_burned,
      fees_collected: data.fees_collected,
      total_supply: data.total_supply,
    });
  }

  getBlockSupply(height: number): BlockSupply | undefined {
    return this.stmtGetBlockSupply.get(height) as BlockSupply | undefined;
  }

  getLatestSupply(): BlockSupply | undefined {
    return this.stmtGetLatestSupply.get() as BlockSupply | undefined;
  }

  getTotalBurned(): number {
    const row = this.stmtGetTotalBurned.get() as { total_burned: number };
    return row.total_burned;
  }

  deleteBlockSupply(height: number): void {
    this.stmtDeleteBlockSupply.run(height);
  }

  /**
   * Delete all indexed data from a given height upwards (inclusive).
   * If no height is given (or 0), wipes all block data entirely.
   * Peers and price_history are left intact.
   */
  reindexFrom(fromHeight: number): void {
    const run = this.db.transaction((h: number) => {
      if (h <= 0) {
        // Full wipe
        this.db.exec(`DELETE FROM inputs`);
        this.db.exec(`DELETE FROM outputs`);
        this.db.exec(`DELETE FROM transactions`);
        this.db.exec(`DELETE FROM block_supply`);
        this.db.exec(`DELETE FROM blocks`);
        this.db.exec(`DELETE FROM sync_state`);
      } else {
        // Partial wipe from height h upwards
        this.db.exec(`
          DELETE FROM inputs WHERE txid IN (
            SELECT txid FROM transactions WHERE block_height >= ${h}
          )
        `);
        this.db.exec(`
          DELETE FROM outputs WHERE txid IN (
            SELECT txid FROM transactions WHERE block_height >= ${h}
          )
        `);
        this.db.exec(`DELETE FROM transactions WHERE block_height >= ${h}`);
        this.db.exec(`DELETE FROM block_supply WHERE height >= ${h}`);
        this.db.exec(`DELETE FROM blocks WHERE height >= ${h}`);
        // Set sync height to one below the target so the poller resumes there
        const newHeight = h - 1;
        this.setSyncHeight(newHeight >= 0 ? newHeight : 0);
      }
    });
    run(fromHeight);
  }

  insertBlockBatch(
    block: Block,
    transactions: Transaction[],
    outputs: Output[],
    inputs: Input[]
  ): void {
    const batchInsert = this.db.transaction(() => {
      this.insertBlock(block);
      for (const tx of transactions) {
        this.insertTransaction(tx);
      }
      for (const out of outputs) {
        this.insertOutput(out);
      }
      for (const inp of inputs) {
        this.insertInput(inp);
      }
    });
    batchInsert();
  }

  private rowToBlock(row: Record<string, unknown>): Block {
    return {
      height: row.height as number,
      hash: row.hash as string,
      prev_hash: row.prev_hash as string,
      timestamp: row.timestamp as number,
      version: row.version as number,
      merkle_root: row.merkle_root as string,
      bits: row.bits as string,
      nonce: row.nonce as number,
      difficulty: row.difficulty as number,
      size: row.size as number,
      weight: row.weight as number,
      tx_count: row.tx_count as number,
      is_pos: (row.is_pos as number) === 1,
      is_blsct: (row.is_blsct as number) === 1,
      chainwork: row.chainwork as string,
    };
  }
}
