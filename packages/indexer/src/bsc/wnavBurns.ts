import {
  createPublicClient,
  http,
  webSocket,
  parseAbiItem,
  type Abi,
  type AbiEvent,
  type Log,
} from "viem";
import { bsc } from "viem/chains";
import { type NetworkType, wnavBridgeNotePrefix } from "@navio-blocks/shared";
import type { Queries } from "../db/queries.js";

const SYNC_KEY_LAST_BLOCK = "bsc_wnav_last_scanned_block";

/** Default wNAV (BEP-20) contract from Navio bridge docs; override with BSC_WNAV_ADDRESS. */
const DEFAULT_WNAV_ADDRESS =
  "0xBFEf6cCFC830D3BaCA4F6766a0d4AaA242Ca9F3D" as const;

const DEFAULT_EVENT =
  "event burnedWithNote(address indexed from, uint256 amount, string note)";

/** PublicNode and similar providers cap `eth_getLogs` block span (often 50k). */
const MAX_LOG_RANGE = 49_999n;

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
 * Index `burnedWithNote` logs from the wNAV BEP-20 contract on BSC.
 * Only persists burns whose `note` starts with the Navio Bech32 prefix for this deployment
 * (`nav1` mainnet, `tnv1` testnet by default; override with `BSC_WNAV_NOTE_PREFIX`).
 * Uses HTTP for historical chunks (50k max) and WebSocket for live logs.
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

  const wssUrl =
    process.env.BSC_WSS_URL?.trim() || "wss://bsc-rpc.publicnode.com";
  const httpUrl =
    process.env.BSC_HTTP_URL?.trim() || "https://bsc-rpc.publicnode.com";

  const httpClient = createPublicClient({
    chain: bsc,
    transport: http(httpUrl),
  });

  const wsClient = createPublicClient({
    chain: bsc,
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
    "[bsc/wnav] BSC RPC: HTTP=%s WSS=%s (contract=%s)",
    httpUrl,
    wssUrl,
    address
  );
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
    from = latest > MAX_LOG_RANGE ? latest - MAX_LOG_RANGE : 0n;
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
      cursor + MAX_LOG_RANGE > latest ? latest : cursor + MAX_LOG_RANGE;
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
        const jump = latest > MAX_LOG_RANGE ? latest - MAX_LOG_RANGE : cursor;
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
      "[bsc/wnav] Backfill complete through block %s (%d burnedWithNote logs scanned)",
      latest.toString(),
      logsSeen,
    );
  }
}
