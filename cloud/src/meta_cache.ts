import type { Env } from "./sources";
import { buildMeta, type MetaPayload } from "./snapshot";

const META_CACHE_TTL_MS = 30_000;
const caches = new WeakMap<object, {
  value?: MetaPayload;
  expiresAt: number;
  pending?: Promise<MetaPayload>;
}>();

export async function cachedMeta(env: Env): Promise<MetaPayload> {
  const key = env.DB as unknown as object;
  const now = Date.now();
  const existing = caches.get(key);
  if (existing?.value && existing.expiresAt > now) return existing.value;
  if (existing?.pending) return existing.pending;

  const pending = buildMeta(env);
  caches.set(key, { pending, expiresAt: now + META_CACHE_TTL_MS });
  try {
    const value = await pending;
    caches.set(key, { value, expiresAt: Date.now() + META_CACHE_TTL_MS });
    return value;
  } catch (error) {
    caches.delete(key);
    throw error;
  }
}
