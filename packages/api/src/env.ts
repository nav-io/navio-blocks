import { existsSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";

const FILE_DIR = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(FILE_DIR, "../../../");

function loadEnvironment(): string | null {
  const candidates = [
    resolve(process.cwd(), ".env"),
    resolve(PROJECT_ROOT, ".env"),
  ];

  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    loadEnv({ path: candidate });
    return candidate;
  }

  return null;
}

export const ENV_PATH = loadEnvironment();

export function resolvePathFromEnv(pathValue: string): string {
  if (isAbsolute(pathValue)) return pathValue;
  const baseDir = ENV_PATH ? dirname(ENV_PATH) : PROJECT_ROOT;
  return resolve(baseDir, pathValue);
}

