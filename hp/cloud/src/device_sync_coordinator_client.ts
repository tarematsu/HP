import type { Env } from "./sources";

const COORDINATOR_NAME = "global";
export const DEVICE_SYNC_MANIFEST_KEY = "device-sync-manifest-v1";

interface DeviceSyncEnv extends Env {
  DEVICE_SYNC_COORDINATOR?: DurableObjectNamespace;
  DEVICE_EXCHANGE_COORDINATOR?: DurableObjectNamespace;
}

function syncCoordinatorStub(env: Env): DurableObjectStub | null {
  const namespace = (env as DeviceSyncEnv).DEVICE_SYNC_COORDINATOR;
  return namespace ? namespace.get(namespace.idFromName(COORDINATOR_NAME)) : null;
}

function exchangeCoordinatorStub(env: Env): DurableObjectStub | null {
  const namespace = (env as DeviceSyncEnv).DEVICE_EXCHANGE_COORDINATOR;
  return namespace ? namespace.get(namespace.idFromName(COORDINATOR_NAME)) : null;
}

export async function requestCoordinatedDeviceExchange(
  env: Env,
  deviceId: string,
  request: Request,
): Promise<Response | null> {
  const stub = exchangeCoordinatorStub(env);
  if (!stub) return null;
  try {
    const forwarded = request.clone();
    const response = await stub.fetch(
      `https://device-exchange.internal/exchange?deviceId=${encodeURIComponent(deviceId)}`,
      {
        method: "POST",
        headers: {
          "Content-Type": request.headers.get("content-type") || "application/json",
        },
        body: forwarded.body,
      },
    );
    if (response.status === 404 || response.status >= 500) {
      await response.body?.cancel();
      throw new Error(`HTTP ${response.status}`);
    }
    return response;
  } catch (error) {
    console.error("device exchange coordinator unavailable; falling back to Worker", error instanceof Error
      ? error.message
      : String(error));
    return null;
  }
}

export async function requestCoordinatedDeviceSync(
  env: Env,
  deviceId: string,
  versions: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  const stub = syncCoordinatorStub(env);
  if (!stub) return null;
  try {
    const response = await stub.fetch("https://device-sync.internal/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceId, versions }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json<Record<string, unknown>>();
  } catch (error) {
    console.error("device sync coordinator unavailable; falling back to D1", error instanceof Error
      ? error.message
      : String(error));
    return null;
  }
}

export async function invalidateCoordinatedDeviceSyncManifest(env: Env): Promise<void> {
  const stub = syncCoordinatorStub(env);
  if (!stub) return;
  const response = await stub.fetch("https://device-sync.internal/invalidate", { method: "POST" });
  if (!response.ok) throw new Error(`device sync manifest invalidation failed: HTTP ${response.status}`);
}
