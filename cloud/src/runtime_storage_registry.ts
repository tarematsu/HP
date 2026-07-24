import type { Env } from "./sources";

// Durable Object storage is actor-context-bound and must never be retained in
// module-global state. Scheduled code receives storage explicitly instead.
export function registerRuntimeStorage(_env: Env, _storage: DurableObjectStorage): void {}

export function runtimeStorageFor(_env: Env): DurableObjectStorage | undefined {
  return undefined;
}
