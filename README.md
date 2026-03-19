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

**Indexer** connects to a running `naviod` node via JSON-RPC, syncs blocks/transactions into a local SQLite database, and periodically fetches peer geolocation data and price info from MEXC.

**API** serves read-only data from SQLite, proxies live mempool data from `naviod`, and in production serves the frontend static build.

**Frontend** is a React SPA with Tailwind CSS, featuring a cyberpunk theme with neon glows, gradient accents, and a dark navy palette.

## Prerequisites

- **Node.js** >= 18
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
| `NETWORK` | `mainnet` | Network type: `mainnet` or `testnet` (affects reward calc) |
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

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/blocks` | Latest blocks (paginated: `limit`, `offset`) |
| GET | `/api/blocks/:hashOrHeight` | Single block by hash or height |
| GET | `/api/blocks/:hashOrHeight/txs` | Transactions in a block |
| GET | `/api/txs/:txid` | Transaction detail with inputs/outputs |
| GET | `/api/search?q=` | Search by block hash, height, or txid |
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
| GET | `/api/health` | Health check |

## Frontend Pages

| Route | Page | Content |
|-------|------|---------|
| `/` | Home | Search bar, stat cards, latest blocks + transactions |
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
- **peers** — connected nodes with geolocation
- **price_history** — NAV price over time
- **block_supply** — per-block reward, burned fees, cumulative supply
- **sync_state** — indexer progress tracking

The database file is created automatically on first run. To resync from scratch, delete the `.db` file and restart the indexer.

## Tech Stack

- **Monorepo**: npm workspaces
- **Indexer**: Node.js, TypeScript, better-sqlite3
- **API**: Fastify 5, @fastify/swagger (OpenAPI 3.0), @fastify/static
- **Frontend**: React 19, Vite, Tailwind CSS, React Router 7, TradingView lightweight-charts
- **Shared**: TypeScript types package

## License

MIT
