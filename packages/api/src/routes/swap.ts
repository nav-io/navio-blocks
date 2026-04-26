import { FastifyInstance } from "fastify";
import { cached } from "../cache.js";
import { fetchNavcoinTipHeight } from "../electrumNavcoin.js";
import type { NavioSwapStatus } from "@navio-blocks/shared";

const DEFAULT_TARGET_HEIGHT = 10_500_000;
const DEFAULT_AVG_BLOCK_SECONDS = 30;
const DEFAULT_ELECTRUM_HOST = "electrum3.nav.community";
const DEFAULT_ELECTRUM_PORT = 50002;

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function envFloat(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = parseFloat(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function envBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (raw === undefined || raw === "") return fallback;
  return !(raw === "0" || raw === "false" || raw === "no");
}

export default async function swapRoutes(app: FastifyInstance) {
  app.get(
    "/api/swap/status",
    {
      schema: {
        tags: ["Swap"],
        summary: "Navcoin → Navio swap activation countdown",
        description:
          "Live status of the Navcoin mainnet height vs the swap activation block (default `10_500_000`). Tip height is read from a public Electrum server (default `electrum3.nav.community:50002` SSL); ETA assumes ~30s spacing.",
        response: {
          200: {
            type: "object",
            properties: {
              target_height: { type: "integer" },
              current_height: { type: "integer", nullable: true },
              blocks_remaining: { type: "integer", nullable: true },
              avg_block_seconds: { type: "number" },
              eta_seconds: { type: "integer", nullable: true },
              eta_timestamp: { type: "integer", nullable: true },
              activated: { type: "boolean" },
              electrum_host: { type: "string" },
              as_of: { type: "integer" },
              error: { type: "string", nullable: true },
            },
          },
        },
      },
    },
    async (): Promise<NavioSwapStatus> => {
      const targetHeight = envInt(
        "NAVCOIN_SWAP_BLOCK",
        DEFAULT_TARGET_HEIGHT
      );
      const avgBlockSeconds = envFloat(
        "NAVCOIN_BLOCK_TIME_SECONDS",
        DEFAULT_AVG_BLOCK_SECONDS
      );
      const electrumHost =
        process.env.NAVCOIN_ELECTRUM_HOST?.trim() || DEFAULT_ELECTRUM_HOST;
      const electrumPort = envInt(
        "NAVCOIN_ELECTRUM_PORT",
        DEFAULT_ELECTRUM_PORT
      );
      const electrumSsl = envBool("NAVCOIN_ELECTRUM_SSL", true);

      return cached(
        `swap:status:${electrumHost}:${electrumPort}:${targetHeight}`,
        20_000,
        async () => {
          const asOf = Math.floor(Date.now() / 1000);
          try {
            const height = await fetchNavcoinTipHeight({
              host: electrumHost,
              port: electrumPort,
              ssl: electrumSsl,
              timeoutMs: 6000,
            });
            const remainingRaw = targetHeight - height;
            const activated = remainingRaw <= 0;
            const blocksRemaining = Math.max(0, remainingRaw);
            const etaSeconds = activated
              ? 0
              : Math.round(blocksRemaining * avgBlockSeconds);
            return {
              target_height: targetHeight,
              current_height: height,
              blocks_remaining: blocksRemaining,
              avg_block_seconds: avgBlockSeconds,
              eta_seconds: etaSeconds,
              eta_timestamp: asOf + etaSeconds,
              activated,
              electrum_host: electrumHost,
              as_of: asOf,
              error: null,
            };
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            app.log.warn({ err: message }, "[swap] Electrum query failed");
            return {
              target_height: targetHeight,
              current_height: null,
              blocks_remaining: null,
              avg_block_seconds: avgBlockSeconds,
              eta_seconds: null,
              eta_timestamp: null,
              activated: false,
              electrum_host: electrumHost,
              as_of: asOf,
              error: message,
            };
          }
        }
      );
    }
  );
}
