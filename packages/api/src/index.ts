import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify, { type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import fastifyStatic from "@fastify/static";
import type { NetworkType } from "@navio-blocks/shared";
import { ENV_PATH } from "./env.js";
import { initExplorerDb } from "./db.js";
import { networkStore } from "./context.js";

import blocksRoutes from "./routes/blocks.js";
import transactionsRoutes from "./routes/transactions.js";
import searchRoutes from "./routes/search.js";
import statsRoutes from "./routes/stats.js";
import mempoolRoutes from "./routes/mempool.js";
import nodesRoutes from "./routes/nodes.js";
import priceRoutes from "./routes/price.js";
import supplyRoutes from "./routes/supply.js";
import tokenRoutes from "./routes/tokens.js";
import bridgeRoutes from "./routes/bridge.js";

const port = Number(process.env.API_PORT ?? 3001);
const host = process.env.API_HOST ?? "0.0.0.0";
const publicApiUrl = process.env.PUBLIC_API_URL?.trim().replace(/\/+$/, "");

function pickHeaderValue(value: string | string[] | undefined): string | undefined {
  if (!value) return undefined;
  const first = Array.isArray(value) ? value[0] : value;
  const normalized = first.split(",")[0]?.trim();
  return normalized && normalized.length > 0 ? normalized : undefined;
}

function resolveServerUrl(request: FastifyRequest): string {
  if (publicApiUrl) return publicApiUrl;

  const protocol =
    pickHeaderValue(request.headers["x-forwarded-proto"]) ??
    request.protocol ??
    "http";
  const hostHeader =
    pickHeaderValue(request.headers["x-forwarded-host"]) ??
    pickHeaderValue(request.headers.host) ??
    `localhost:${port}`;

  return `${protocol}://${hostHeader}`;
}

async function main() {
  if (ENV_PATH) {
    console.log(`[api] Loaded env from ${ENV_PATH}`);
  } else {
    console.warn(
      "[api] No .env file found in current directory or project root; using process env only"
    );
  }

  await initExplorerDb();

  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
    },
  });

  // CORS — allow all origins for development
  await app.register(cors, { origin: true });

  // Swagger / OpenAPI
  await app.register(swagger, {
    openapi: {
      openapi: "3.0.0",
      info: {
        title: "Navio Block Explorer API",
        description: "REST API for the Navio blockchain explorer",
        version: "1.0.0",
      },
      servers: [{ url: publicApiUrl || "/" }],
    },
  });

  await app.register(swaggerUi, {
    routePrefix: "/docs",
    transformSpecification: (swaggerObject, request) => ({
      ...swaggerObject,
      servers: [{ url: resolveServerUrl(request) }],
    }),
    transformSpecificationClone: true,
  });

  // Routes — registered once per network. Mainnet is served under `/api/*`
  // and testnet under `/api/testnet/*`. An onRequest hook stamps the active
  // network into AsyncLocalStorage so db / rpc / cache helpers stay scoped.
  const networkMounts: { network: NetworkType; prefix: string }[] = [
    { network: "mainnet", prefix: "/api" },
    { network: "testnet", prefix: "/api/testnet" },
  ];

  for (const { network, prefix } of networkMounts) {
    await app.register(
      async (scope) => {
        scope.addHook("onRequest", (_request, _reply, done) => {
          networkStore.enterWith(network);
          done();
        });
        await scope.register(blocksRoutes);
        await scope.register(transactionsRoutes);
        await scope.register(searchRoutes);
        await scope.register(statsRoutes);
        await scope.register(mempoolRoutes);
        await scope.register(nodesRoutes);
        await scope.register(priceRoutes);
        await scope.register(supplyRoutes);
        await scope.register(tokenRoutes);
        await scope.register(bridgeRoutes);
      },
      { prefix }
    );
  }

  // Serve frontend static build in production
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const frontendDist = resolve(__dirname, '../../frontend/dist');
  if (existsSync(frontendDist)) {
    await app.register(fastifyStatic, {
      root: frontendDist,
      prefix: "/",
      wildcard: false,
    });
    // SPA fallback — serve index.html for non-API routes
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith("/api/")) {
        return reply.status(404).send({ error: "Not found" });
      }
      return reply.sendFile("index.html");
    });
  }

  // Health check
  app.get("/api/health", {
    schema: {
      tags: ["Health"],
      description: "Health check endpoint",
      response: { 200: { type: 'object', properties: { status: { type: 'string' } } } },
    },
  }, async () => ({ status: "ok" }));

  await app.listen({ port, host });
  app.log.info(`Swagger docs available at ${publicApiUrl || `http://localhost:${port}`}/docs`);
}

main().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
