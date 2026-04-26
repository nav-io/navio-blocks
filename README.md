# Navio Block Explorer

A full-stack block explorer for [Navio](https://navcoin.org), a Bitcoin Core fork with BLSCT privacy (hidden amounts, stealth addresses). Unlike traditional explorers, this shows structural blockchain data (blocks, transaction counts, types) while respecting BLSCT privacy — amounts and parties are never revealed for shielded outputs.

## Architecture

```
navio-blocks/
├── packages/
│   ├── shared/        TypeScript types shared across packages
│   ├── indexer/       Polls naviod RPC, writes to SQLite
│   ├── api/           Fastify REST API with Swagger docs
│   └── frontend/      React SPA with cyberpunk UI
```

**Indexer** connects to a running `naviod` node via JSON-RPC, syncs blocks/transactions into a local SQLite database, and periodically fetches peer geolocation data and price info from MEXC. Optionally it indexes **BSC wNAV → Navio** bridge burns from chain logs, and/or syncs a **BLSCT audit wallet** via `navio-sdk` + Electrum when an audit key is configured.

**API** serves read-only data from SQLite, proxies live mempool data from `naviod`, and in production serves the frontend static build.

**Frontend** is a React SPA with Tailwind CSS, featuring a cyberpunk theme with neon glows, gradient accents, and a dark navy palette.

## Prerequisites

- **Node.js** >= 20.19 (required by the indexer, including optional `navio-sdk` BLSCT audit sync)
- **npm** >= 9
- **naviod** running with RPC enabled

Start `naviod` with RPC access:

```bash
naviod -server -rpcuser=YOUR_USER -rpcpassword=YOUR_PASS
```

Or configure via `navio.conf`:

```
server=1
rpcuser=YOUR_USER
rpcpassword=YOUR_PASS
rpcport=33677
```

## Setup

```bash
# Clone and install
git clone <repo-url> navio-blocks
cd navio-blocks
npm install

# Configure environment
cp .env.example .env
# Edit .env with your naviod RPC credentials
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `RPC_HOST` | `127.0.0.1` | naviod RPC host |
| `RPC_PORT` | `33677` | naviod RPC port |
| `RPC_USER` | | naviod RPC username |
| `RPC_PASSWORD` | | naviod RPC password |
| `NETWORK` | `mainnet` | Network type: `mainnet` or `testnet` (block rewards; BSC burn note prefix; `navio-sdk` audit client; should match your `naviod` chain) |
| `TESTNET_BOOTSTRAP_NODES` | `testnet.nav.io,testnet2.nav.io` | Comma-separated seed nodes for direct testnet P2P crawling |
| `MAINNET_BOOTSTRAP_NODES` | | Comma-separated seed nodes for direct mainnet P2P crawling |
| `P2P_PORT` | | Optional port override for all direct P2P peer crawls |
| `TESTNET_P2P_PORT` | `33670` | Default direct testnet P2P port when seed entry omits a port |
| `MAINNET_P2P_PORT` | `8333` | Default direct mainnet P2P port when seed entry omits a port |
| `P2P_MESSAGE_MAGIC_HEX` | | Optional message-start override (8 hex chars), supersedes network-specific magic |
| `P2P_TESTNET_MAGIC_HEX` | `1c03bb83` | Testnet message-start bytes for direct P2P wire parsing |
| `P2P_MAINNET_MAGIC_HEX` | `dbd2b1ac` | Mainnet message-start bytes for direct P2P wire parsing |
| `P2P_PROTOCOL_VERSION` | `70016` | Protocol version announced in direct P2P `version` handshake |
| `P2P_REQUEST_TIMEOUT_MS` | `4500` | Timeout for a single direct P2P handshake/`getaddr` request |
| `P2P_CRAWL_CONCURRENCY` | `24` | Concurrent direct P2P peer crawls per discovery round |
| `PEER_DISCOVERY_ROUNDS` | `3` | Seeder-style direct P2P crawl rounds (`version`/`verack` + `getaddr`) |
| `PEER_DISCOVERY_BATCH_SIZE` | `64` | Nodes to directly crawl per round |
| `PEER_DISCOVERY_WAIT_MS` | `1200` | Wait between crawl rounds before processing newly learned peers |
| `PEER_DISCOVERY_MAX_CANDIDATES` | `2000` | Upper bound for addresses tracked in one crawl cycle |
| `PEER_CONNECT_TIMEOUT_MS` | `2000` | TCP timeout for connectivity probes |
| `PEER_CONNECT_CONCURRENCY` | `48` | Parallel TCP probes when testing discovered peers |
| `PEER_CONNECT_TEST_LIMIT` | `300` | Number of discovered peers to connectivity-test per cycle |
| `PEER_DISCOVERY_FILTER_UNREACHABLE` | `true` | When true on testnet, drop probe-tested peers that fail TCP |
| `PEER_GEO_LOOKUP_LIMIT` | `80` | Max uncached geo lookups per cycle (rate-limited to stay under ip-api limits) |
| `API_PORT` | `3001` | API server port |
| `DB_PATH` | `./navio-blocks.db` | SQLite database path |
| `VITE_API_URL` | `http://localhost:3001` | Frontend API URL (dev only) |
| `LOG_LEVEL` | `info` | Fastify log level |
| `API_HOST` | `0.0.0.0` | API bind address |

#### BSC wNAV bridge burns (indexer)

| Variable | Default | Description |
|----------|---------|-------------|
| `BSC_WNAV_ENABLED` | enabled | Set to `0` or `false` to disable BSC log indexing |
| `BSC_WNAV_ADDRESS` | (mainnet contract) | wNAV BEP-20 contract `0x…` on BSC |
| `BSC_HTTP_URL` | PublicNode HTTP | RPC URL for historical `eth_getLogs` chunks |
| `BSC_WSS_URL` | PublicNode WSS | WebSocket RPC for live `burnedWithNote` events |
| `BSC_WNAV_EVENT` | `burnedWithNote` ABI fragment | Override if the contract event differs |
| `BSC_WNAV_NOTE_PREFIX` | (from `NETWORK`) | Override Navio destination note prefix: default **`nav1`** on mainnet, **`tnv1`** on testnet (matches navio-core `bech32_mod_hrp`). Use the same value on **indexer and API** |

The API filters stored burns by this prefix so the explorer matches the chain you run (`NETWORK`).

#### BLSCT audit wallet (indexer, optional)

When `NAVIO_AUDIT_KEY` or `AUDIT_KEY` is set, the indexer runs [navio-sdk](https://github.com/nav-io/navio-sdk) `NavioClient` (Electrum + local SQLite wallet DB), derives **outgoing native NAV payouts** from the audited wallet (same approach as the navio-bridge audit UI), and stores a snapshot in the main explorer DB for the API. The indexer loads the SDK’s **CommonJS** build (`require('navio-sdk')`). Because the published SDK **bundles** a copy of `better-sqlite3`, the native addon path would otherwise resolve incorrectly (e.g. under `packages/indexer/`). The repo **`postinstall`** script patches `navio-sdk/dist/index.js` so the wallet adapter uses the hoisted **`better-sqlite3`** dependency from `node_modules` (with a correctly built `better_sqlite3.node`). After `npm install`, ensure the patch logged `[patch-navio-sdk] NodeAdapter now uses external better-sqlite3` (or `already applied`). If the patch fails, upgrade/downgrade `navio-sdk` may have changed the bundle — check `scripts/patch-navio-sdk-external-better-sqlite3.cjs`. On restricted hosts, install build tools so `better-sqlite3` can compile: `python3`, `make`, `g++`.

| Variable | Default | Description |
|----------|---------|-------------|
| `NAVIO_AUDIT_KEY` / `AUDIT_KEY` | | BLSCT audit key: 160 hex chars (32-byte view key \|\| 48-byte public spend key) |
| `NAVIO_AUDIT_ENABLED` | enabled if key set | `0` / `false` to disable |
| `NAVIO_AUDIT_WALLET_PATH` | next to `DB_PATH` | Path to the SDK’s wallet SQLite file (`navio-audit-wallet.db`) |
| `NAVIO_AUDIT_RESTORE_HEIGHT` / `AUDIT_RESTORE_HEIGHT` | `0` | `restoreFromHeight` — first block height to scan |
| `NAVIO_ELECTRUM_HOST` | `testnet.nav.io` / `mainnet.nav.io` | Electrum server host (override per environment) |
| `NAVIO_ELECTRUM_PORT` | `50004` (wss) / `50005` (ws) | Electrum WebSocket port; default depends on `NAVIO_ELECTRUM_SSL`. The navio-sdk Electrum client speaks WebSocket, so use `50004`/`50005`, not the raw-TCP ports `50001`/`50002`. |
| `NAVIO_ELECTRUM_SSL` | `true` | Set `0` / `false` for plaintext |
| `NAVIO_AUDIT_INTERVAL_MS` | `900000` | Resync interval (ms), minimum 60s |

Use the same **`NETWORK`** (`mainnet` \| `testnet`) as for the rest of the indexer so the SDK uses correct chain parameters.

## Development

Build the shared types first (required once, or after changing types):

```bash
npm run build:shared
```

Run all three services simultaneously with color-coded, labeled output:

```bash
npm run dev
```

This starts:
- **[IDX]** Indexer — syncs blocks from naviod to SQLite (hot-reloads via `tsx watch`)
- **[API]** API server on port 3001 (hot-reloads via `tsx watch`)
- **[WEB]** Frontend dev server on port 5173 (Vite, proxies `/api` to port 3001)

Or run services individually:

```bash
npm run dev:indexer    # Indexer only
npm run dev:api        # API only
npm run dev:frontend   # Frontend only
```

## Production

```bash
# Build everything (shared → indexer → api → frontend)
npm run build

# Start indexer + API (API serves frontend static build)
npm start
```

In production the API serves the compiled frontend at `/` and API endpoints at `/api/*`, so only one port is exposed. The Swagger docs are available at `/docs`.

For process management, consider `pm2`:

```bash
npm install -g pm2
pm2 start "npm run start:indexer" --name navio-indexer
pm2 start "npm run start:api" --name navio-api
pm2 save
```

## Reindexing

To wipe all indexed data and resync from genesis:

```bash
npm run reindex
```

To reindex from a specific block height (keeps data below that height):

```bash
npm run reindex:from 5000
```

Both commands start the indexer after clearing, so it will immediately begin syncing. Peer and price data are preserved across reindexes.

You can also pass flags directly:

```bash
# Dev mode
npm -w packages/indexer run dev -- --reindex
npm -w packages/indexer run dev -- --from 5000

# Production (compiled)
node packages/indexer/dist/index.js --reindex
node packages/indexer/dist/index.js --from=5000
```

Run `npm -w packages/indexer run dev -- --help` to see all options.

## API Endpoints

All endpoints are documented via Swagger UI at `http://localhost:3001/docs`.

### Search

`GET /api/search?q=` resolves:

- **Block height** — decimal string, e.g. `12345`
- **Full 64-char hex** — block hash, txid, output hash, or token collection id (first match wins)
- **NFT** — `tokenId#index` (64-char hex + `#` + digits)
- **Partial hex** (4–63 hex chars, optional `0x` prefix) — returns `type: "multi"` with up to 25 matches each in **blocks** (hash / prev_hash / merkle_root), **transactions**, **outputs**, and **token / NFT collection** ids. Pure-digit queries try block height first; if no block exists, partial matching still runs (so fragments like `1234` can match txids).

The SPA search bar jumps to a detail page for a single hit, or to `/search?q=…` for multi-match results.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/blocks` | Latest blocks (paginated: `limit`, `offset`) |
| GET | `/api/blocks/:hashOrHeight` | Single block by hash or height |
| GET | `/api/blocks/:hashOrHeight/txs` | Transactions in a block |
| GET | `/api/txs/:txid` | Transaction detail with inputs/outputs |
| GET | `/api/search?q=` | Search (height, full/partial hex, token id, `token#nft`) |
| GET | `/api/stats` | Network overview (height, difficulty, BLSCT %, etc.) |
| GET | `/api/stats/chart?period=` | Chart data for block times and tx counts |
| GET | `/api/mempool` | Live mempool stats (proxied from naviod) |
| GET | `/api/nodes` | Connected peers with geolocation |
| GET | `/api/nodes/map` | Peer data formatted for map visualization |
| GET | `/api/price` | Current NAV price (USD, BTC) + 24h change |
| GET | `/api/price/history?period=` | Price history (24h, 7d, 30d, 1y) |
| GET | `/api/supply` | Current supply overview (total, max, burned, reward) |
| GET | `/api/supply/chart?period=` | Supply over time chart data (24h, 7d, 30d, 1y, all) |
| GET | `/api/supply/block/:height` | Supply data for a specific block |
| GET | `/api/supply/burned` | Burned fees summary (total, 24h, 7d, 30d) |
| GET | `/api/bridge/burns` | BSC wNAV burns (`burnedWithNote` → Navio note prefix from `NETWORK` / `BSC_WNAV_NOTE_PREFIX`) |
| GET | `/api/bridge/audit/summary` | BLSCT audit snapshot: balance, sync height, errors, total outgoing (requires indexer audit key) |
| GET | `/api/bridge/audit/outgoing` | Paginated outgoing NAV payouts from the audited wallet (`limit`, `offset`) |
| GET | `/api/health` | Health check |

## Frontend Pages

| Route | Page | Content |
|-------|------|---------|
| `/` | Home | Search bar, stat cards, latest blocks + transactions |
| `/search` | Search results | Grouped matches for partial-hex and multi-hit queries (`?q=`) |
| `/blocks` | Block List | Paginated block table |
| `/block/:id` | Block Detail | Block header + transaction list |
| `/tx/:txid` | Transaction | Metadata + BLSCT-aware inputs/outputs |
| `/network` | Network | Node count, world map, version distribution |
| `/supply` | Supply | Total supply, burned fees, supply chart, reward info |
| `/price` | Price | Price chart, volume, market cap |

## Navio-Specific Design

**BLSCT Privacy**: Transactions are tagged as BLSCT or Transparent. BLSCT outputs display cryptographic keys (spending key, ephemeral key, view tag) but amounts show as "Hidden". Transparent outputs show addresses and values normally.

**Outpoint Model**: Navio uses a single output hash as the outpoint identifier — not the traditional `txid:vout` pair. Each output has a unique `output_hash`, and inputs reference spent outputs via `prev_out` (a single hash).

**Proof of Stake**: Blocks are detected as PoS when the coinbase transaction is followed by a coinstake transaction (first output is zero-value nonstandard).

**Supply Tracking**: The indexer computes per-block supply data:
- **PoW blocks** (heights 1-1000): 50 NAV subsidy, halving every 210,000 blocks. Fees go to miner.
- **BLSCT/PoS blocks** (testnet, heights > 1000): fixed 4 NAV reward. Height 1 gets 75M NAV bootstrap. **Fees are burned** (OP_RETURN outputs are unspendable).
- **Max supply**: 250,000,000 NAV. Set `NETWORK=testnet` for testnet reward rules.

## Database

SQLite with WAL mode. Tables:

- **blocks** — block headers (PK: height)
- **transactions** — tx metadata (PK: txid)
- **outputs** — transparent values or BLSCT keys (PK: output_hash)
- **inputs** — spent outpoint references (PK: txid, vin)
- **token_collections** / **nft_items** — token/NFT registry metadata
- **peers** — connected nodes with geolocation
- **price_history** — NAV price over time
- **block_supply** — per-block reward, burned fees, cumulative supply
- **sync_state** — indexer progress tracking
- **bsc_wnav_burns** — BSC `burnedWithNote` events (bridge burns toward Navio)
- **navio_audit_meta** / **navio_audit_outgoing** — optional BLSCT audit wallet snapshot (balance, sync tip, derived outgoing payout rows)

The database file is created automatically on first run. To resync from scratch, delete the `.db` file and restart the indexer.

The SDK also creates a **separate** wallet file (default `navio-audit-wallet.db` beside `DB_PATH`) when audit indexing is enabled; that file is managed by `navio-sdk`, not the explorer schema above.

## Tech Stack

- **Monorepo**: npm workspaces
- **Indexer**: Node.js, TypeScript, better-sqlite3; optional **navio-sdk** + **viem** (BLSCT audit sync, BSC log indexing)
- **API**: Fastify 5, @fastify/swagger (OpenAPI 3.0), @fastify/static
- **Frontend**: React 19, Vite, Tailwind CSS, React Router 7, TradingView lightweight-charts
- **Shared**: TypeScript types package

## License

MIT
