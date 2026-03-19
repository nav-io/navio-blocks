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
      predicate_args_json TEXT
    );

    CREATE TABLE IF NOT EXISTS inputs (
      txid        TEXT,
      vin         INTEGER,
      prev_out    TEXT,
      is_coinbase INTEGER DEFAULT 0,
      PRIMARY KEY (txid, vin)
    );

    CREATE TABLE IF NOT EXISTS peers (
      id         INTEGER PRIMARY KEY,
      addr       TEXT,
      subversion TEXT,
      services   TEXT,
      country    TEXT,
      city       TEXT,
      lat        REAL,
      lon        REAL,
      last_seen  INTEGER,
      first_seen INTEGER
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
  `);

  // Lightweight migrations for existing DBs.
  ensureColumn(db, "transactions", "raw_json", "TEXT");
  ensureColumn(db, "blocks", "is_blsct", "INTEGER DEFAULT 0");
  ensureColumn(db, "outputs", "output_type", "TEXT DEFAULT 'unknown'");
  ensureColumn(db, "outputs", "spk_type", "TEXT");
  ensureColumn(db, "outputs", "spk_hex", "TEXT");
  ensureColumn(db, "outputs", "token_id", "TEXT");
  ensureColumn(db, "outputs", "predicate", "TEXT");
  ensureColumn(db, "outputs", "predicate_hex", "TEXT");
  ensureColumn(db, "outputs", "predicate_args_json", "TEXT");

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
  db.exec(`UPDATE outputs SET output_type = 'fee' WHERE UPPER(COALESCE(predicate, '')) IN ('PAY_FEE', 'DATA')`);
  db.exec(`UPDATE outputs SET output_type = 'transfer' WHERE output_type = 'unknown' AND is_blsct = 1`);
  db.exec(`UPDATE outputs SET output_type = 'transfer' WHERE output_type = 'unknown' AND (token_id IS NULL OR token_id = '0000000000000000000000000000000000000000000000000000000000000000') AND spk_type IN ('nonstandard', 'op_true', 'pubkeyhash', 'scripthash', 'witness_v0_keyhash', 'witness_v0_scripthash', 'witness_v1_taproot', 'pubkey', 'multisig')`);

  // OP_TRUE (51) scripts: remap nonstandard → op_true for correct display
  db.exec(`UPDATE outputs SET spk_type = 'op_true' WHERE spk_type = 'nonstandard' AND spk_hex = '51'`);
  db.exec(`UPDATE outputs SET spk_type = 'unspendable' WHERE spk_type = 'nulldata' OR spk_hex = '6a'`);

  return db;
}
