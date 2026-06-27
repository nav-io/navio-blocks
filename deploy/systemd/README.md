# systemd deployment — dual network

Runs the explorer as three managed services: one indexer per network and a
single API process that serves both (`/api/*` = mainnet, `/api/testnet/*` =
testnet) plus the built frontend.

## Layout assumed by the units

- Repo checked out at `/opt/navio-blocks`, owned by user/group `navio`.
- `node` at `/usr/bin/node` (Node >= 20.19). Adjust `ExecStart` if elsewhere.
- Config files in the repo root:
  - `.env` — shared + mainnet API config + `TESTNET_*` (copy from `.env.example`)
  - `.env.mainnet` — mainnet indexer (copy from `.env.mainnet.example`)
  - `.env.testnet` — testnet indexer (copy from `.env.testnet.example`)

Edit `User`, `Group`, `WorkingDirectory`, and the `EnvironmentFile`/`ExecStart`
paths if your deployment differs.

## Install

```sh
cd /opt/navio-blocks
npm ci && npm run build          # builds shared, indexer, api, frontend

sudo cp deploy/systemd/navio-*.service deploy/systemd/navio-explorer.target /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now navio-explorer.target
```

`navio-explorer.target` pulls in both indexers and the API. Manage them
together:

```sh
sudo systemctl restart navio-explorer.target
sudo systemctl status navio-indexer-mainnet navio-indexer-testnet navio-api
journalctl -u navio-api -f
```

## Reverse proxy

Point your TLS terminator (nginx/Caddy) at the API (`API_PORT`, default 3001).
No path rewriting is needed — the API already namespaces networks under
`/api/*` and `/api/testnet/*` and serves the SPA for everything else.

## Migrating an existing single-network (testnet) deployment

The previous setup kept testnet data in `navio-blocks.db`. To preserve it:

1. In `.env.testnet`, set `DB_PATH=./navio-blocks.db` (or rename the file to
   `./navio-blocks.testnet.db` and keep the default).
2. In `.env`, set `TESTNET_DB_PATH` to that same path, and `DB_PATH` to a fresh
   mainnet file (e.g. `./navio-blocks.mainnet.db`).
3. Configure the mainnet indexer's RPC in `.env.mainnet` and let it sync.
