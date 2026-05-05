import {
  createPublicClient,
  http,
  webSocket,
  parseAbiItem,
  type Abi,
  type AbiEvent,
  type Log,
} from "viem";
import { bsc, bscTestnet } from "viem/chains";
import { type NetworkType, wnavBridgeNotePrefix } from "@navio-blocks/shared";
import type { Queries } from "../db/queries.js";

const SYNC_KEY_LAST_BLOCK = "bsc_wnav_last_scanned_block";

/** Default wNAV (BEP-20) contract from Navio bridge docs; override with BSC_WNAV_ADDRESS. */
const DEFAULT_WNAV_ADDRESS =
  "0xBFEf6cCFC830D3BaCA4F6766a0d4AaA242Ca9F3D" as const;

// Verified on BSC mainnet (topic0
// 0xb127fdad471edaf7e0c498b52f590e889813ed697831d285e7af6941f5ee4084).
// Solidity convention is PascalCase event names; an earlier copy of this file
// had `burnedWithNote` (lowercase) which produces a different keccak256 and
// silently matches zero logs.
const DEFAULT_EVENT =
  "event BurnedWithNote(address indexed from, uint256 amount, string note)";

/**
 * Max inclusive block span per `eth_getLogs` / `getContractEvents` chunk.
 * QuikNode and many providers enforce 10k; PublicNode often allows ~50k.
 */
const GETLOGS_MAX_BLOCK_SPAN = 10_000n;

/** On cold start (no cursor), how far behind chain tip to begin scanning. */
const INITIAL_LOOKBACK_BLOCKS = 49_999n;

/** Default cadence for the HTTP poll that backstops the WSS subscription. */
const DEFAULT_POLL_INTERVAL_MS = 30_000;
/** Heartbeat log cadence so an idle watcher still reports liveness. */
const DEFAULT_HEARTBEAT_INTERVAL_MS = 60_000;

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function envBool(name: string): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

/**
 * Pick BSC mainnet vs testnet. Defaults to BSC mainnet because navio's wNAV
 * bridge contract lives on BSC mainnet for both navio mainnet (`nav1` notes)
 * and navio testnet (`tnv1` notes). Override with `BSC_CHAIN=testnet` only if
 * you really have a separate wNAV deployment on BSC testnet.
 */
function resolveBscChain(_network: NetworkType) {
  const explicit = process.env.BSC_CHAIN?.trim().toLowerCase();
  const isTestnet =
    explicit === "testnet" ||
    explicit === "bsctestnet" ||
    explicit === "bsc_testnet";
  return isTestnet ? bscTestnet : bsc;
}

function isWnavToNavioNote(note: string | null, expectedPrefix: string): boolean {
  if (note == null || note.length === 0) return false;
  return note.trim().toLowerCase().startsWith(expectedPrefix.toLowerCase());
}

function getAddress(): `0x${string}` {
  const raw = (process.env.BSC_WNAV_ADDRESS ?? DEFAULT_WNAV_ADDRESS).trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(raw)) {
    throw new Error(
      `[bsc/wnav] Invalid BSC_WNAV_ADDRESS: ${raw} (expected 0x + 40 hex chars)`
    );
  }
  return raw.toLowerCase() as `0x${string}`;
}

function getBurnEvent(): AbiEvent {
  const frag = (process.env.BSC_WNAV_EVENT ?? DEFAULT_EVENT).trim();
  return parseAbiItem(frag) as AbiEvent;
}

function burnAbi(event: AbiEvent): Abi {
  return [event] as Abi;
}

export interface WnavBurnWatcher {
  stop: () => void;
}

export interface WnavBurnWatcherOptions {
  /** Resolved chain (same as block indexer); selects default note prefix unless `BSC_WNAV_NOTE_PREFIX` is set. */
  network: NetworkType;
}

/**
 * Index `BurnedWithNote` logs from the wNAV BEP-20 contract on BSC.
 * Only persists burns whose `note` starts with the Navio Bech32 prefix for this deployment
 * (`nav1` mainnet, `tnv1` testnet by default; override with `BSC_WNAV_NOTE_PREFIX`).
 * Uses HTTP for historical chunks (bounded by GETLOGS_MAX_BLOCK_SPAN per RPC) and WebSocket for live logs.
 */
export function startWnavBurnWatcher(
  queries: Queries,
  options: WnavBurnWatcherOptions
): WnavBurnWatcher {
  const notePrefix = wnavBridgeNotePrefix(
    options.network,
    process.env.BSC_WNAV_NOTE_PREFIX
  );
  const address = getAddress();
  const event = getBurnEvent();
  const abi = burnAbi(event);
  const eventName = event.name;

  const chain = resolveBscChain(options.network);
  const isBscTestnet = chain.id === bscTestnet.id;
  const defaultHttp = isBscTestnet
    ? "https://bsc-testnet-rpc.publicnode.com"
    : "https://bsc-rpc.publicnode.com";
  const defaultWss = isBscTestnet
    ? "wss://bsc-testnet-rpc.publicnode.com"
    : "wss://bsc-rpc.publicnode.com";

  const wssUrl = process.env.BSC_WSS_URL?.trim() || defaultWss;
  const httpUrl = process.env.BSC_HTTP_URL?.trim() || defaultHttp;

  const httpClient = createPublicClient({
    chain,
    transport: http(httpUrl),
  });

  const wsClient = createPublicClient({
    chain,
    transport: webSocket(wssUrl),
  });

  const blockTsCache = new Map<string, number>();

  async function blockTimestamp(blockNumber: bigint): Promise<number> {
    const key = blockNumber.toString();
    const hit = blockTsCache.get(key);
    if (hit !== undefined) return hit;
    const block = await httpClient.getBlock({ blockNumber });
    const ts = Number(block.timestamp);
    blockTsCache.set(key, ts);
    return ts;
  }

  async function persistLog(log: {
    transactionHash?: `0x${string}` | null;
    logIndex?: number | null;
    blockNumber?: bigint | null;
    args?: Record<string, unknown> | readonly unknown[];
  }): Promise<void> {
    if (!log.transactionHash || log.logIndex == null || log.blockNumber == null) return;
    const args = log.args;
    if (!args || typeof args !== "object" || Array.isArray(args)) return;
    const a = args as Record<string, unknown>;
    const from =
      typeof a.from === "string"
        ? a.from
        : a.from !== undefined
          ? String(a.from)
          : null;
    const amountRaw = a.amount;
    const amount =
      typeof amountRaw === "bigint"
        ? amountRaw.toString()
        : amountRaw !== undefined
          ? String(amountRaw)
          : "0";
    const noteRaw = a.note;
    const note =
      typeof noteRaw === "string"
        ? noteRaw
        : noteRaw !== undefined
          ? String(noteRaw)
          : null;

    if (!isWnavToNavioNote(note, notePrefix)) {
      console.log(
        "[bsc/wnav] Skipping burn (note %s does not start with %s) block=%s tx=%s amount=%s",
        note ?? "<null>",
        notePrefix,
        log.blockNumber.toString(),
        log.transactionHash,
        amount,
      );
      return;
    }

    const timestamp = await blockTimestamp(log.blockNumber);
    queries.insertBscWnavBurn({
      tx_hash: log.transactionHash as string,
      log_index: Number(log.logIndex),
      block_number: Number(log.blockNumber),
      timestamp,
      from_address: from,
      amount,
      note,
    });
    console.log(
      "[bsc/wnav] Stored burn block=%s tx=%s amount=%s note=%s",
      log.blockNumber.toString(),
      log.transactionHash,
      amount,
      note
    );
  }

  let stopped = false;
  let unwatch: (() => void) | undefined;
  let pollTimer: NodeJS.Timeout | undefined;
  let heartbeatTimer: NodeJS.Timeout | undefined;
  let pollRunning = false;

  const pollIntervalMs = envInt("BSC_WNAV_POLL_INTERVAL_MS", DEFAULT_POLL_INTERVAL_MS);
  const heartbeatIntervalMs = envInt(
    "BSC_WNAV_HEARTBEAT_INTERVAL_MS",
    DEFAULT_HEARTBEAT_INTERVAL_MS,
  );
  const debug = envBool("BSC_WNAV_DEBUG");

  console.log(
    "[bsc/wnav] Filtering burns to destination notes starting with %s (network=%s)",
    notePrefix,
    options.network
  );
  console.log(
    "[bsc/wnav] BSC chain: %s (id=%d)%s",
    chain.name,
    chain.id,
    isBscTestnet ? " — testnet" : "",
  );
  console.log(
    "[bsc/wnav] BSC RPC: HTTP=%s WSS=%s (contract=%s)",
    httpUrl,
    wssUrl,
    address
  );
  if (!process.env.BSC_WNAV_ADDRESS && isBscTestnet) {
    console.warn(
      "[bsc/wnav] WARNING: BSC chain is testnet but BSC_WNAV_ADDRESS is not set; " +
        "the default contract %s is the BSC mainnet wNAV deployment and will not " +
        "exist on BSC testnet. Set BSC_WNAV_ADDRESS to the testnet wNAV contract.",
      DEFAULT_WNAV_ADDRESS,
    );
  }
  // One-shot rewind: BSC_WNAV_REWIND_TO=<block> lets you re-scan history (e.g.
  // after fixing the event signature) without hand-editing sync_state. Cleared
  // by the user removing the env var on next restart — we don't persist it.
  const rewindRaw = process.env.BSC_WNAV_REWIND_TO?.trim();
  if (rewindRaw && /^\d+$/.test(rewindRaw)) {
    const before = queries.getSyncState(SYNC_KEY_LAST_BLOCK);
    queries.setSyncState(SYNC_KEY_LAST_BLOCK, rewindRaw);
    console.log(
      "[bsc/wnav] BSC_WNAV_REWIND_TO=%s applied (was %s); next backfill will re-scan from there.",
      rewindRaw,
      before ?? "<unset>",
    );
  } else if (rewindRaw) {
    console.warn(
      "[bsc/wnav] Ignoring BSC_WNAV_REWIND_TO=%s — must be a positive integer block number.",
      rewindRaw,
    );
  }

  const cursorAtStart = queries.getSyncState(SYNC_KEY_LAST_BLOCK);
  console.log(
    "[bsc/wnav] Last scanned block in DB: %s",
    cursorAtStart ?? "<none — will start at tip - 50k>"
  );
  console.log(
    "[bsc/wnav] HTTP poll interval=%dms heartbeat=%dms debug=%s",
    pollIntervalMs,
    heartbeatIntervalMs,
    debug ? "on" : "off",
  );

  // One-shot diagnostic: list every topic0 the contract emits over the last N
  // blocks. If the user's burn isn't being indexed, the topic0 of the actual
  // burn event will appear here and they can set BSC_WNAV_EVENT to match.
  if (debug) {
    void probeContractTopics(httpClient, address).catch((err) => {
      console.warn(
        "[bsc/wnav][probe] failed:",
        err instanceof Error ? err.message : err,
      );
    });
  }

  async function runBackfill(verbose: boolean): Promise<void> {
    if (pollRunning || stopped) return;
    pollRunning = true;
    try {
      await backfill(
        httpClient,
        queries,
        address,
        eventName,
        abi,
        persistLog,
        verbose,
        debug,
      );
    } catch (err) {
      console.error(
        "[bsc/wnav] Backfill error:",
        err instanceof Error ? err.message : err
      );
    } finally {
      pollRunning = false;
    }
  }

  void (async () => {
    await runBackfill(true);
    if (stopped) return;

    try {
      unwatch = wsClient.watchContractEvent({
        address,
        abi,
        eventName,
        onLogs: (logs: Log[]) => {
          void (async () => {
            for (const log of logs) {
              try {
                await persistLog(log);
              } catch (e) {
                console.error(
                  "[bsc/wnav] Failed to store log:",
                  e instanceof Error ? e.message : e
                );
              }
            }
          })();
        },
        onError: (err: Error) => {
          console.error("[bsc/wnav] WebSocket watcher error:", err.message);
        },
      });
      console.log(
        "[bsc/wnav] Watching %s::%s via %s",
        address,
        eventName,
        wssUrl
      );
    } catch (err) {
      console.error(
        "[bsc/wnav] Failed to start WebSocket watcher:",
        err instanceof Error ? err.message : err
      );
    }

    // BSC public RPCs (PublicNode et al.) silently drop `eth_subscribe`
    // streams after a while without firing onError. A short HTTP poll keeps
    // the cursor advancing even if the WSS feed has gone quiet.
    pollTimer = setInterval(() => {
      void runBackfill(false);
    }, pollIntervalMs);
    heartbeatTimer = setInterval(() => {
      void (async () => {
        const cursorRaw = queries.getSyncState(SYNC_KEY_LAST_BLOCK);
        let tipStr = "?";
        let lagStr = "?";
        try {
          const tip = await httpClient.getBlockNumber();
          tipStr = tip.toString();
          if (cursorRaw && /^\d+$/.test(cursorRaw)) {
            const lag = tip - BigInt(cursorRaw);
            lagStr = lag >= 0n ? lag.toString() : "0";
          }
        } catch (e) {
          tipStr = `err:${e instanceof Error ? e.message : String(e)}`;
        }
        console.log(
          "[bsc/wnav] Watcher alive cursor=%s tip=%s lag=%s prefix=%s",
          cursorRaw ?? "<none>",
          tipStr,
          lagStr,
          notePrefix,
        );
      })();
    }, heartbeatIntervalMs);
  })();

  return {
    stop: () => {
      stopped = true;
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = undefined;
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      heartbeatTimer = undefined;
      unwatch?.();
      unwatch = undefined;
    },
  };
}

/**
 * Diagnostic: fetch every log emitted by the contract over the recent
 * ~`PROBE_BLOCK_RANGE` blocks and print the unique topic0 hashes with counts.
 * Lets us identify the actual burn event signature when the configured one
 * doesn't match (BscScan calls the function "Burn With Note" but the emitted
 * event name/casing is what we filter on).
 */
const PROBE_BLOCK_RANGE = 10_000n;
async function probeContractTopics(
  httpClient: ReturnType<typeof createPublicClient>,
  address: `0x${string}`,
): Promise<void> {
  const tip = await httpClient.getBlockNumber();
  const fromBlock = tip > PROBE_BLOCK_RANGE ? tip - PROBE_BLOCK_RANGE : 0n;
  console.log(
    "[bsc/wnav][probe] Scanning %s for ALL log topics in blocks %s..%s",
    address,
    fromBlock.toString(),
    tip.toString(),
  );
  const logs = await httpClient.getLogs({
    address,
    fromBlock,
    toBlock: tip,
  });
  if (logs.length === 0) {
    console.log("[bsc/wnav][probe] No logs found on contract in this range.");
    return;
  }
  const counts = new Map<string, { count: number; sampleTx: string; indexedArgs: number }>();
  for (const log of logs) {
    const t0 = (log.topics[0] ?? "<no-topic0>") as string;
    const indexedArgs = Math.max(0, log.topics.length - 1);
    const entry = counts.get(t0) ?? {
      count: 0,
      sampleTx: log.transactionHash ?? "?",
      indexedArgs,
    };
    entry.count += 1;
    counts.set(t0, entry);
  }
  console.log(
    "[bsc/wnav][probe] %d log(s) across %d distinct event signature(s):",
    logs.length,
    counts.size,
  );
  // Standard ERC-20 event signatures we can label without a lookup.
  const KNOWN: Record<string, string> = {
    "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef":
      "Transfer(address,address,uint256)",
    "0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925":
      "Approval(address,address,uint256)",
    "0xbc7cd75a20ee27fd9adebab32041f755214dbc6bffa90cc0225b39da2e5c2d3b":
      "AdminChanged (proxy)",
    "0x7e644d79422f17c01e4894b5f4f588d331ebfa28653d42ae832dc59e38c9798f":
      "AdminChanged (legacy proxy)",
    "0x2f8788117e7eff1d82e926ec794901d17c78024a50270940304540a733656f0d":
      "RoleGranted(bytes32,address,address)",
    "0xf6391f5c32d9c69d2a47ea670b442974b53935d1edc7fd64eb21e047a839171b":
      "RoleRevoked(bytes32,address,address)",
    "0xb127fdad471edaf7e0c498b52f590e889813ed697831d285e7af6941f5ee4084":
      "BurnedWithNote(address,uint256,string) ← wNAV bridge burn",
  };
  const sorted = [...counts.entries()].sort((a, b) => b[1].count - a[1].count);
  for (const [topic0, info] of sorted) {
    const label = KNOWN[topic0] ?? "<unknown — likely your burn event>";
    console.log(
      "[bsc/wnav][probe]   topic0=%s indexed=%d count=%d sample_tx=%s  %s",
      topic0,
      info.indexedArgs,
      info.count,
      info.sampleTx,
      label,
    );
  }
  console.log(
    "[bsc/wnav][probe] If your burn event is the <unknown> one above, set BSC_WNAV_EVENT to its full Solidity signature, e.g.:\n" +
      "  BSC_WNAV_EVENT='event BurnedWithNote(address indexed from, uint256 amount, string note)'",
  );
}

async function backfill(
  httpClient: ReturnType<typeof createPublicClient>,
  queries: Queries,
  address: `0x${string}`,
  eventName: string,
  abi: Abi,
  persistLog: (log: {
    transactionHash?: `0x${string}` | null;
    logIndex?: number | null;
    blockNumber?: bigint | null;
    args?: Record<string, unknown> | readonly unknown[];
  }) => Promise<void>,
  verbose: boolean,
  debug: boolean,
): Promise<void> {
  const latest = await httpClient.getBlockNumber();
  const stored = queries.getSyncState(SYNC_KEY_LAST_BLOCK);
  let from: bigint;
  if (stored !== null && /^\d+$/.test(stored)) {
    from = BigInt(stored) + 1n;
  } else {
    from =
      latest > INITIAL_LOOKBACK_BLOCKS
        ? latest - INITIAL_LOOKBACK_BLOCKS
        : 0n;
  }

  if (from > latest) {
    if (verbose) {
      console.log(
        "[bsc/wnav] Cursor (%s) is at/past chain tip (%s); nothing to backfill. To re-scan, rewind 'bsc_wnav_last_scanned_block' in sync_state.",
        from.toString(),
        latest.toString()
      );
    }
    queries.setSyncState(SYNC_KEY_LAST_BLOCK, latest.toString());
    return;
  }

  if (verbose) {
    console.log(
      "[bsc/wnav] Backfilling %s::%s from block %s to %s",
      address,
      eventName,
      from.toString(),
      latest.toString()
    );
  } else if (debug) {
    console.log(
      "[bsc/wnav] Poll: scanning %s..%s (%s blocks)",
      from.toString(),
      latest.toString(),
      (latest - from + 1n).toString(),
    );
  }

  let cursor = from;
  let logsSeen = 0;
  while (cursor <= latest) {
    const to =
      cursor + GETLOGS_MAX_BLOCK_SPAN - 1n > latest
        ? latest
        : cursor + GETLOGS_MAX_BLOCK_SPAN - 1n;
    let logs;
    try {
      logs = await httpClient.getContractEvents({
        address,
        abi,
        eventName,
        fromBlock: cursor,
        toBlock: to,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("pruned")) {
        const jump =
          latest > INITIAL_LOOKBACK_BLOCKS
            ? latest - INITIAL_LOOKBACK_BLOCKS
            : cursor;
        console.warn(
          "[bsc/wnav] Pruned history at block %s; jumping forward to %s",
          cursor.toString(),
          jump.toString()
        );
        if (jump <= cursor) {
          console.warn("[bsc/wnav] Cannot backfill older blocks on this RPC; live events only");
          queries.setSyncState(SYNC_KEY_LAST_BLOCK, latest.toString());
          return;
        }
        cursor = jump;
        continue;
      }
      throw err;
    }

    logsSeen += logs.length;
    for (const log of logs) {
      await persistLog(log);
    }

    queries.setSyncState(SYNC_KEY_LAST_BLOCK, to.toString());
    cursor = to + 1n;
  }

  queries.setSyncState(SYNC_KEY_LAST_BLOCK, latest.toString());
  if (verbose || logsSeen > 0) {
    console.log(
      "[bsc/wnav] Backfill complete through block %s (%d BurnedWithNote logs scanned)",
      latest.toString(),
      logsSeen,
    );
  }
}
