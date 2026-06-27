import { existsSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";

const FILE_DIR = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(FILE_DIR, "../../../");

function loadEnvironment(): string | null {
  // ENV_FILE (if set) is loaded first and wins; the base .env fills the rest.
  // dotenv does not override already-set keys, so first-loaded takes priority.
  const envFile = process.env.ENV_FILE
    ? resolve(process.cwd(), process.env.ENV_FILE)
    : null;
  const candidates = [
    envFile,
    resolve(process.cwd(), ".env"),
    resolve(PROJECT_ROOT, ".env"),
  ].filter((p): p is string => p !== null);

  let firstLoaded: string | null = null;
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    loadEnv({ path: candidate });
    if (!firstLoaded) firstLoaded = candidate;
  }

  return firstLoaded;
}

export const ENV_PATH = loadEnvironment();

export function resolvePathFromEnv(pathValue: string): string {
  if (isAbsolute(pathValue)) return pathValue;
  const baseDir = ENV_PATH ? dirname(ENV_PATH) : PROJECT_ROOT;
  return resolve(baseDir, pathValue);
}

