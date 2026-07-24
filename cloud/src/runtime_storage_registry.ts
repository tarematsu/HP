import type { Env } from "./sources";

const RUNTIME_STORES = new WeakMap<object, DurableObjectStorage>();

function keyFor(env: Env): object {
  return env.DB as unknown as object;
}

export function registerRuntimeStorage(env: Env, storage: DurableObjectStorage): void {
  RUNTIME_STORES.set(keyFor(env), storage);
}

export function runtimeStorageFor(env: Env): DurableObjectStorage | undefined {
  return RUNTIME_STORES.get(keyFor(env));
}
