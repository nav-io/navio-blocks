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
      is_blsct      INTEGER DEFAULT 0
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

    CREATE INDEX IF NOT EXISTS idx_transactions_block_height ON transactions(block_height);
    CREATE INDEX IF NOT EXISTS idx_outputs_txid              ON outputs(txid);
    CREATE INDEX IF NOT EXISTS idx_outputs_address           ON outputs(address);
    CREATE INDEX IF NOT EXISTS idx_blocks_hash               ON blocks(hash);
    CREATE INDEX IF NOT EXISTS idx_blocks_timestamp          ON blocks(timestamp);
  `);

  // Lightweight migrations for existing DBs.
  ensureColumn(db, "transactions", "raw_json", "TEXT");
  ensureColumn(db, "blocks", "is_blsct", "INTEGER DEFAULT 0");

  return db;
}
