import Database from "better-sqlite3";

function ensureColumn(
  db: Database.Database,
  tableName: string,
  columnName: string,
  columnDefSql: string
): void {
  const columns = db
    .prepare(`PRAGMA table_info(${tableName})`)
    .all() as Array<{ name: string }>;
  const hasColumn = columns.some((col) => col.name === columnName);
  if (!hasColumn) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDefSql}`);
  }
}

export function initDatabase(dbPath: string): Database.Database {
  const db = new Database(dbPath);

  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS sync_state (
      key   TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS blocks (
      height      INTEGER PRIMARY KEY,
      hash        TEXT UNIQUE NOT NULL,
      prev_hash   TEXT,
      timestamp   INTEGER,
      version     INTEGER,
      merkle_root TEXT,
      bits        TEXT,
      nonce       INTEGER,
      difficulty  REAL,
      size        INTEGER,
      weight      INTEGER,
      tx_count    INTEGER,
      is_pos      INTEGER DEFAULT 0,
      is_blsct    INTEGER DEFAULT 0,
      chainwork   TEXT
    );

    CREATE TABLE IF NOT EXISTS transactions (
      txid         TEXT PRIMARY KEY,
      block_height INTEGER REFERENCES blocks(height),
      tx_index     INTEGER,
      version      INTEGER,
      size         INTEGER,
      vsize        INTEGER,
      locktime     INTEGER,
      is_coinbase  INTEGER DEFAULT 0,
      is_blsct     INTEGER DEFAULT 0,
      input_count  INTEGER,
      output_count INTEGER,
      has_token    INTEGER DEFAULT 0,
      raw_json     TEXT
    );

    CREATE TABLE IF NOT EXISTS outputs (
      output_hash   TEXT PRIMARY KEY,
      txid          TEXT NOT NULL,
      n             INTEGER NOT NULL,
      value_sat     INTEGER,
      address       TEXT,
      spending_key  TEXT,
      ephemeral_key TEXT,
      blinding_key  TEXT,
      view_tag      TEXT,
      is_blsct      INTEGER DEFAULT 0,
      output_type   TEXT DEFAULT 'unknown',
      spk_type      TEXT,
      spk_hex       TEXT,
      token_id      TEXT,
      predicate     TEXT,
      predicate_hex TEXT,
      predicate_args_json TEXT,
      delegated     INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS inputs (
      txid        TEXT,
      vin         INTEGER,
      prev_out    TEXT,
      is_coinbase INTEGER DEFAULT 0,
      PRIMARY KEY (txid, vin)
    );

    CREATE TABLE IF NOT EXISTS peers (
      id             INTEGER PRIMARY KEY,
      addr           TEXT,
      subversion     TEXT,
      services       TEXT,
      country        TEXT,
      city           TEXT,
      lat            REAL,
      lon            REAL,
      last_seen      INTEGER,
      first_seen     INTEGER,
      last_handshake INTEGER
    );

    CREATE TABLE IF NOT EXISTS price_history (
      timestamp  INTEGER PRIMARY KEY,
      price_usd  REAL,
      price_btc  REAL,
      volume_24h REAL,
      market_cap REAL
    );

    CREATE TABLE IF NOT EXISTS block_supply (
      height         INTEGER PRIMARY KEY REFERENCES blocks(height),
      block_reward   INTEGER NOT NULL DEFAULT 0,
      fees_burned    INTEGER NOT NULL DEFAULT 0,
      fees_collected INTEGER NOT NULL DEFAULT 0,
      total_supply   INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS token_collections (
      token_id         TEXT PRIMARY KEY,
      token_type       TEXT NOT NULL DEFAULT 'unknown',
      public_key       TEXT,
      max_supply       INTEGER,
      metadata_json    TEXT,
      create_txid      TEXT NOT NULL REFERENCES transactions(txid) ON DELETE CASCADE,
      create_output_hash TEXT,
      create_height    INTEGER NOT NULL,
      create_timestamp INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS nft_items (
      token_id         TEXT NOT NULL,
      nft_index        TEXT NOT NULL,
      nft_id           TEXT PRIMARY KEY,
      metadata_json    TEXT,
      mint_txid        TEXT NOT NULL REFERENCES transactions(txid) ON DELETE CASCADE,
      mint_output_hash TEXT,
      mint_height      INTEGER NOT NULL,
      mint_timestamp   INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_transactions_block_height ON transactions(block_height);
    CREATE INDEX IF NOT EXISTS idx_outputs_txid              ON outputs(txid);
    CREATE INDEX IF NOT EXISTS idx_outputs_address           ON outputs(address);
    CREATE INDEX IF NOT EXISTS idx_inputs_prev_out           ON inputs(prev_out);
    CREATE INDEX IF NOT EXISTS idx_blocks_hash               ON blocks(hash);
    CREATE INDEX IF NOT EXISTS idx_blocks_timestamp          ON blocks(timestamp);
    CREATE INDEX IF NOT EXISTS idx_token_collections_type    ON token_collections(token_type);
    CREATE INDEX IF NOT EXISTS idx_token_collections_height  ON token_collections(create_height);
    CREATE INDEX IF NOT EXISTS idx_nft_items_token_id        ON nft_items(token_id);
    CREATE INDEX IF NOT EXISTS idx_nft_items_mint_height     ON nft_items(mint_height);

    CREATE TABLE IF NOT EXISTS bsc_wnav_burns (
      tx_hash      TEXT    NOT NULL,
      log_index    INTEGER NOT NULL,
      block_number INTEGER NOT NULL,
      timestamp    INTEGER NOT NULL,
      from_address TEXT,
      amount       TEXT    NOT NULL,
      note         TEXT,
      PRIMARY KEY (tx_hash, log_index)
    );

    CREATE INDEX IF NOT EXISTS idx_bsc_wnav_burns_timestamp ON bsc_wnav_burns(timestamp DESC);

    CREATE TABLE IF NOT EXISTS navio_audit_outgoing (
      spend_tx_hash TEXT PRIMARY KEY NOT NULL,
      block_height INTEGER NOT NULL,
      amount_sat TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_navio_audit_outgoing_block ON navio_audit_outgoing(block_height DESC);

    CREATE TABLE IF NOT EXISTS navio_audit_stake_events (
      tx_hash TEXT NOT NULL,
      event_type TEXT NOT NULL,    -- 'stake' (commitment created) | 'unstake' (commitment spent without re-staking)
      block_height INTEGER NOT NULL,
      amount_sat TEXT NOT NULL,
      PRIMARY KEY (tx_hash, event_type)
    );

    CREATE INDEX IF NOT EXISTS idx_navio_audit_stake_events_block ON navio_audit_stake_events(block_height DESC);

    CREATE TABLE IF NOT EXISTS navio_audit_awaiting (
      tx_hash TEXT,          -- BSC burn tx
      amount_sat TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      note TEXT              -- destination Navio address
    );

    CREATE TABLE IF NOT EXISTS navio_audit_meta (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      balance_sat TEXT NOT NULL DEFAULT '0',
      earned_rewards_sat TEXT NOT NULL DEFAULT '0',
      synced_height INTEGER NOT NULL DEFAULT 0,
      chain_tip INTEGER NOT NULL DEFAULT 0,
      error_message TEXT,
      updated_at INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS p2pmsg_stats (
      timestamp                   INTEGER NOT NULL,
      network                     TEXT    NOT NULL,
      enabled                     INTEGER NOT NULL DEFAULT 0,
      relay_capable_peers         INTEGER NOT NULL DEFAULT 0,
      total_peers                 INTEGER NOT NULL DEFAULT 0,
      agg_available               INTEGER NOT NULL DEFAULT 0,
      agg_extra_fee_per_candidate INTEGER NOT NULL DEFAULT 0,
      orders_count                INTEGER NOT NULL DEFAULT 0,
      orders_bytes                INTEGER NOT NULL DEFAULT 0,
      rfqs_count                  INTEGER NOT NULL DEFAULT 0,
      pings_received              INTEGER NOT NULL DEFAULT 0,
      identity_pubkey             TEXT,
      inbox_pubkey                TEXT,
      PRIMARY KEY (network, timestamp)
    );

    CREATE INDEX IF NOT EXISTS idx_p2pmsg_stats_network_ts ON p2pmsg_stats(network, timestamp);

    -- Periodic snapshot of the node's unspent staked-commitment set
    -- (liststakedcommitmentsdata) next to the explorer's own view, so the
    -- staking page can chart the staked set and flag index/node drift.
    CREATE TABLE IF NOT EXISTS staking_stats (
      timestamp             INTEGER NOT NULL,
      network               TEXT    NOT NULL,
      node_height           INTEGER NOT NULL DEFAULT 0,
      active_commitments    INTEGER NOT NULL DEFAULT 0,
      delegated_commitments INTEGER NOT NULL DEFAULT 0,
      db_active             INTEGER NOT NULL DEFAULT 0,
      db_delegated          INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (network, timestamp)
    );
    CREATE INDEX IF NOT EXISTS idx_staking_stats_network_ts ON staking_stats(network, timestamp);
  `);

  // Lightweight migrations for existing DBs.
  ensureColumn(db, "transactions", "raw_json", "TEXT");
  ensureColumn(db, "blocks", "is_blsct", "INTEGER DEFAULT 0");
  ensureColumn(db, "outputs", "output_type", "TEXT DEFAULT 'unknown'");
  ensureColumn(db, "navio_audit_meta", "earned_rewards_sat", "TEXT NOT NULL DEFAULT '0'");
  // Burn↔payout reconciliation snapshot.
  ensureColumn(db, "navio_audit_meta", "settled_sat", "TEXT NOT NULL DEFAULT '0'");
  ensureColumn(db, "navio_audit_meta", "awaiting_sat", "TEXT NOT NULL DEFAULT '0'");
  ensureColumn(db, "navio_audit_meta", "unmatched_payout_sat", "TEXT NOT NULL DEFAULT '0'");
  ensureColumn(db, "navio_audit_meta", "unmatched_payout_count", "INTEGER NOT NULL DEFAULT 0");
  // 1 when a payout reconciles 1:1 to burn(s); 0 flags an unmatched outflow.
  ensureColumn(db, "navio_audit_outgoing", "matched", "INTEGER NOT NULL DEFAULT 1");
  ensureColumn(db, "outputs", "spk_type", "TEXT");
  ensureColumn(db, "outputs", "spk_hex", "TEXT");
  ensureColumn(db, "outputs", "token_id", "TEXT");
  ensureColumn(db, "outputs", "predicate", "TEXT");
  ensureColumn(db, "outputs", "predicate_hex", "TEXT");
  ensureColumn(db, "outputs", "predicate_args_json", "TEXT");
  ensureColumn(db, "outputs", "delegated", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "peers", "last_handshake", "INTEGER");
  // p2pmsg overlay time-series columns (for DBs created before a given column existed).
  ensureColumn(db, "p2pmsg_stats", "enabled", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "p2pmsg_stats", "relay_capable_peers", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "p2pmsg_stats", "total_peers", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "p2pmsg_stats", "agg_available", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "p2pmsg_stats", "agg_extra_fee_per_candidate", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "p2pmsg_stats", "orders_count", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "p2pmsg_stats", "orders_bytes", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "p2pmsg_stats", "rfqs_count", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "p2pmsg_stats", "pings_received", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "p2pmsg_stats", "identity_pubkey", "TEXT");
  ensureColumn(db, "p2pmsg_stats", "inbox_pubkey", "TEXT");

  // Indexes on migrated columns (must run after ensureColumn)
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_outputs_type     ON outputs(output_type);
    CREATE INDEX IF NOT EXISTS idx_outputs_token_id ON outputs(token_id);
  `);

  // Remap removed output types to current enum values
  db.exec(`UPDATE outputs SET output_type = 'transfer' WHERE output_type IN ('blsct', 'native', 'unstake')`);
  db.exec(`UPDATE outputs SET output_type = 'fee' WHERE output_type = 'data'`);
  db.exec(`UPDATE outputs SET output_type = 'token_create' WHERE UPPER(COALESCE(predicate, '')) = 'CREATE_TOKEN'`);
  db.exec(`UPDATE outputs SET output_type = 'token_mint' WHERE UPPER(COALESCE(predicate, '')) IN ('MINT_TOKEN', 'MINT')`);
  db.exec(`UPDATE outputs SET output_type = 'nft_mint' WHERE UPPER(COALESCE(predicate, '')) IN ('MINT_NFT', 'NFT_MINT')`);
  // A staked commitment (script starts with OP_STAKED_COMMITMENT = 0xb9) may carry
  // a DATA predicate: that is a cold-staking delegation, NOT a fee output. Older
  // indexer versions classified those as 'fee'; restore them before the generic
  // predicate → fee remap below, which now excludes staking scripts.
  db.exec(`UPDATE outputs SET output_type = 'stake' WHERE output_type <> 'coinbase' AND substr(LOWER(COALESCE(spk_hex, '')), 1, 2) = 'b9' AND UPPER(COALESCE(predicate, '')) = 'DATA'`);
  db.exec(`UPDATE outputs SET output_type = 'fee' WHERE UPPER(COALESCE(predicate, '')) IN ('PAY_FEE', 'DATA') AND output_type <> 'stake'`);
  // Delegation flag: DATA predicate whose payload starts with the delegation magic
  // "NVDG\x01" (4e56444701) right after the op byte (04) and a 1/3/5-byte compact size.
  db.exec(`UPDATE outputs SET delegated = 1
           WHERE output_type = 'stake' AND UPPER(COALESCE(predicate, '')) = 'DATA' AND delegated = 0
             AND substr(LOWER(COALESCE(predicate_hex, '')), 1, 2) = '04'
             AND (substr(LOWER(predicate_hex), 5, 10) = '4e56444701'
               OR substr(LOWER(predicate_hex), 9, 10) = '4e56444701'
               OR substr(LOWER(predicate_hex), 13, 10) = '4e56444701')`);
  db.exec(`UPDATE outputs SET output_type = 'transfer' WHERE output_type = 'unknown' AND is_blsct = 1`);
  db.exec(`UPDATE outputs SET output_type = 'transfer' WHERE output_type = 'unknown' AND (token_id IS NULL OR token_id = '0000000000000000000000000000000000000000000000000000000000000000') AND spk_type IN ('nonstandard', 'op_true', 'pubkeyhash', 'scripthash', 'witness_v0_keyhash', 'witness_v0_scripthash', 'witness_v1_taproot', 'pubkey', 'multisig')`);

  // OP_TRUE (51) scripts: remap nonstandard → op_true for correct display
  db.exec(`UPDATE outputs SET spk_type = 'op_true' WHERE spk_type = 'nonstandard' AND spk_hex = '51'`);
  db.exec(`UPDATE outputs SET spk_type = 'unspendable' WHERE spk_type = 'nulldata' OR spk_hex = '6a'`);

  return db;
}
