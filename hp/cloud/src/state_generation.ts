import { invalidateCoordinatedDeviceSyncManifest } from "./device_sync_coordinator";
import type { Env } from "./sources";

const STATE_GENERATIONS = new WeakMap<object, number>();
const STATE_INVALIDATIONS = new WeakMap<object, Promise<void>>();

function keyFor(env: Env): object {
  return env.DB as unknown as object;
}

export function stateGeneration(env: Env): number {
  return STATE_GENERATIONS.get(keyFor(env)) ?? 0;
}

export async function markStateChanged(env: Env): Promise<number> {
  const key = keyFor(env);
  const next = (STATE_GENERATIONS.get(key) ?? 0) + 1;
  STATE_GENERATIONS.set(key, next);

  const previous = STATE_INVALIDATIONS.get(key) ?? Promise.resolve();
  const invalidation = previous
    .catch(() => {})
    .then(() => invalidateCoordinatedDeviceSyncManifest(env))
    .catch(error => {
      console.error("device sync manifest invalidation failed", error instanceof Error ? error.message : String(error));
    });
  STATE_INVALIDATIONS.set(key, invalidation);
  await invalidation;
  if (STATE_INVALIDATIONS.get(key) === invalidation) STATE_INVALIDATIONS.delete(key);
  return next;
}

export async function awaitStateInvalidation(env: Env): Promise<void> {
  await STATE_INVALIDATIONS.get(keyFor(env));
}

export function resetStateGeneration(env: Env): void {
  const key = keyFor(env);
  STATE_GENERATIONS.delete(key);
  STATE_INVALIDATIONS.delete(key);
}
