import type { Env } from "./sources";

export interface CachedStateRow {
  source: string;
  version: number;
  payload: string;
  observed_at: number | null;
  fetched_at: number;
  last_success_at: number | null;
  status: "ok" | "stale" | "error";
  error: string | null;
  content_hash: string | null;
}

const STATE_CACHE_PREFIX = "state:v1:";
let activeTestScope: string | null = null;
let scopeSequence = 0;

function stateCacheKey(source: string): string {
  return `${STATE_CACHE_PREFIX}${activeTestScope ?? "prod"}:${source}`;
}

export function invalidateStateCacheScope(_db: D1Database): void {
  scopeSequence += 1;
  activeTestScope = `test-${scopeSequence}`;
}

function validNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function validNullableNumber(value: unknown): value is number | null {
  return value === null || validNumber(value);
}

function validNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isCachedStateRow(value: unknown, source: string): value is CachedStateRow {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return row.source === source
    && validNumber(row.version)
    && typeof row.payload === "string"
    && validNullableNumber(row.observed_at)
    && validNumber(row.fetched_at)
    && validNullableNumber(row.last_success_at)
    && ["ok", "stale", "error"].includes(String(row.status))
    && validNullableString(row.error)
    && validNullableString(row.content_hash);
}

export async function readCachedState(env: Env, source: string): Promise<CachedStateRow | null> {
  if (!env.STATE_CACHE) return null;
  try {
    const value = await env.STATE_CACHE.get<unknown>(stateCacheKey(source), "json");
    return isCachedStateRow(value, source) ? value : null;
  } catch (error) {
    console.error("KV state read failed", source, error instanceof Error ? error.message : String(error));
    return null;
  }
}

export async function writeCachedState(env: Env, row: CachedStateRow): Promise<void> {
  if (!env.STATE_CACHE) return;
  try {
    await env.STATE_CACHE.put(stateCacheKey(row.source), JSON.stringify(row));
  } catch (error) {
    console.error("KV state write failed", row.source, error instanceof Error ? error.message : String(error));
  }
}

export async function deleteCachedState(env: Env, source: string): Promise<void> {
  if (!env.STATE_CACHE) return;
  try {
    await env.STATE_CACHE.delete(stateCacheKey(source));
  } catch (error) {
    console.error("KV state delete failed", source, error instanceof Error ? error.message : String(error));
  }
}
