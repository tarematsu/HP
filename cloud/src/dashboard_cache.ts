import { buildMeta, ensureDashboard, sha256Hex, type MetaPayload, type StateRow } from "./snapshot";
import type { Env } from "./sources";

const STATE_CACHE_TTL_MS = 60_000;

interface CacheEntry<T> {
  value?: T;
  expiresAt: number;
  pending?: Promise<T>;
}

export interface CachedJson {
  payload: string;
  hash: string;
}

const dashboardCaches = new WeakMap<object, CacheEntry<StateRow>>();
const metaCaches = new WeakMap<object, CacheEntry<CachedJson>>();

function keyFor(env: Env): object {
  return env.DB as unknown as object;
}

async function cached<T>(
  caches: WeakMap<object, CacheEntry<T>>,
  env: Env,
  loader: () => Promise<T>,
): Promise<T> {
  const key = keyFor(env);
  const now = Date.now();
  const existing = caches.get(key);
  if (existing?.value && existing.expiresAt > now) return existing.value;
  if (existing?.pending && existing.expiresAt > now) return existing.pending;

  const pending = loader();
  caches.set(key, { pending, expiresAt: now + STATE_CACHE_TTL_MS });
  try {
    const value = await pending;
    caches.set(key, { value, expiresAt: Date.now() + STATE_CACHE_TTL_MS });
    return value;
  } catch (error) {
    caches.delete(key);
    throw error;
  }
}

function cachedEtag<T extends { content_hash?: string | null }>(
  caches: WeakMap<object, CacheEntry<T>>,
  env: Env,
): string | null {
  const entry = caches.get(keyFor(env));
  if (!entry?.value || entry.expiresAt <= Date.now()) return null;
  return entry.value.content_hash ? `"${entry.value.content_hash}"` : null;
}

export async function cachedDashboard(env: Env): Promise<StateRow> {
  return cached(dashboardCaches, env, () => ensureDashboard(env));
}

export function cachedDashboardEtag(env: Env): string | null {
  return cachedEtag(dashboardCaches, env);
}

export async function cachedMeta(env: Env): Promise<CachedJson> {
  return cached(metaCaches, env, async () => {
    const value: MetaPayload = await buildMeta(env);
    const payload = JSON.stringify(value);
    return { payload, hash: await sha256Hex(payload) };
  });
}

export function cachedMetaEtag(env: Env): string | null {
  const entry = metaCaches.get(keyFor(env));
  if (!entry?.value || entry.expiresAt <= Date.now()) return null;
  return `"${entry.value.hash}"`;
}

export function invalidateStateCaches(env: Env): void {
  const key = keyFor(env);
  dashboardCaches.delete(key);
  metaCaches.delete(key);
}
