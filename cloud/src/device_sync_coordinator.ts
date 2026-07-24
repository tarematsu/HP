import type { Env } from "./sources";

const COORDINATOR_NAME = "global";
export const DEVICE_SYNC_MANIFEST_KEY = "device-sync-manifest-v1";

interface CoordinatorEnv extends Env {
  SCHEDULER_COORDINATOR?: DurableObjectNamespace;
}

function coordinatorStub(env: Env): DurableObjectStub | null {
  const namespace = (env as CoordinatorEnv).SCHEDULER_COORDINATOR;
  return namespace ? namespace.get(namespace.idFromName(COORDINATOR_NAME)) : null;
}

export async function requestCoordinatedDeviceSync(
  env: Env,
  deviceId: string,
  versions: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  const stub = coordinatorStub(env);
  if (!stub) return null;
  const response = await stub.fetch("https://scheduler.internal/device-sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ deviceId, versions }),
  });
  if (!response.ok) {
    throw new Error(`device sync coordinator failed: HTTP ${response.status}`);
  }
  return response.json<Record<string, unknown>>();
}

export async function invalidateCoordinatedDeviceSyncManifest(env: Env): Promise<void> {
  const stub = coordinatorStub(env);
  if (!stub) return;
  const response = await stub.fetch("https://scheduler.internal/device-sync-invalidate", {
    method: "POST",
  });
  if (!response.ok) {
    throw new Error(`device sync manifest invalidation failed: HTTP ${response.status}`);
  }
}
