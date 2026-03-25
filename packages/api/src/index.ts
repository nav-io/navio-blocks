import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify, { type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import fastifyStatic from "@fastify/static";
import { ENV_PATH } from "./env.js";

import blocksRoutes from "./routes/blocks.js";
import transactionsRoutes from "./routes/transactions.js";
import searchRoutes from "./routes/search.js";
import statsRoutes from "./routes/stats.js";
import mempoolRoutes from "./routes/mempool.js";
import nodesRoutes from "./routes/nodes.js";
import priceRoutes from "./routes/price.js";
import supplyRoutes from "./routes/supply.js";
import tokenRoutes from "./routes/tokens.js";

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

  // Routes
  await app.register(blocksRoutes);
  await app.register(transactionsRoutes);
  await app.register(searchRoutes);
  await app.register(statsRoutes);
  await app.register(mempoolRoutes);
  await app.register(nodesRoutes);
  await app.register(priceRoutes);
  await app.register(supplyRoutes);
  await app.register(tokenRoutes);

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
