import { configuredDeviceTokens, DEVICE_ID_PATTERN } from "./auth";
import { enqueueCommandOnce } from "./device_control";
import { readState, updateState } from "./snapshot";
import { readUpdateManifestIdentity } from "./update_proxy";
import type { Env } from "./sources";

const HEARTBEAT_WINDOW_MS = 30 * 86_400_000;
const COMMAND_TTL_SECONDS = 86_400;
const UPDATE_PING_COOLDOWN_MS = 60_000;
const SCHEDULER_COORDINATOR_NAME = "global";

type ActiveUpdateCheck = {
  db: D1Database;
  bucket: R2Bucket;
  promise: Promise<void>;
};

interface UpdateCheckSchedulerEnv extends Env {
  SCHEDULER_COORDINATOR?: DurableObjectNamespace;
}

async function knownDeviceIds(env: Env): Promise<Set<string>> {
  const ids = new Set<string>();
  for (const deviceId of configuredDeviceTokens(env)?.keys() ?? []) ids.add(deviceId);
  const primary = env.HOMEPANEL_PRIMARY_DEVICE_ID?.trim() ?? "";
  if (DEVICE_ID_PATTERN.test(primary)) ids.add(primary);
  const cutoff = Date.now() - HEARTBEAT_WINDOW_MS;
  const rows = await env.DB.prepare(
    "SELECT device_id FROM device_heartbeats WHERE last_seen_at >= ?1",
  ).bind(cutoff).all<{ device_id: string }>();
  for (const row of rows.results ?? []) {
    if (DEVICE_ID_PATTERN.test(row.device_id)) ids.add(row.device_id);
  }
  return ids;
}

let lastUpdatePingAt = 0;
let activeUpdateCheck: ActiveUpdateCheck | null = null;

async function performUpdateCheck(env: Env): Promise<void> {
  const identity = await readUpdateManifestIdentity(env);
  const previous = await readState(env, "update");
  let previousVersion = "";
  let previousManifestHash = "";
  if (previous?.payload) {
    try {
      const value = JSON.parse(previous.payload) as {
        version?: unknown;
        manifestHash?: unknown;
      };
      previousVersion = String(value.version ?? "");
      previousManifestHash = String(value.manifestHash ?? "");
    } catch {
    }
  }
  if (identity.version === previousVersion && identity.manifestHash === previousManifestHash) return;

  // A hash-only mutation under the same version is not a new release. Automatically
  // installing it would reinterpret a packaging collision as a repair and can stop
  // an already-current native app. Explicit local repair remains available.
  if (previousVersion && identity.version !== previousVersion) {
    const payload = JSON.stringify({
      reason: "release",
      version: identity.version,
      manifestHash: identity.manifestHash,
    });
    for (const deviceId of await knownDeviceIds(env)) {
      await enqueueCommandOnce(env, deviceId, "check_update", payload, COMMAND_TTL_SECONDS);
    }
  }

  await updateState(env, {
    source: "update",
    payload: identity,
    observedAt: Date.now(),
  });
}

// Share work only when both binding objects match; separate test and deployment
// environments must remain independent even inside the same JavaScript isolate.
function coalescedUpdateCheck(env: Env): Promise<void> {
  const bucket = env.UPDATE_BUCKET;
  if (!bucket) return Promise.resolve();

  const active = activeUpdateCheck;
  if (active && active.db === env.DB && active.bucket === bucket) return active.promise;

  const promise = performUpdateCheck(env).finally(() => {
    if (activeUpdateCheck?.promise === promise) activeUpdateCheck = null;
  });
  activeUpdateCheck = { db: env.DB, bucket, promise };
  return promise;
}

async function signalUpdateCheck(env: Env): Promise<void> {
  const namespace = (env as UpdateCheckSchedulerEnv).SCHEDULER_COORDINATOR;
  if (!namespace) throw new Error("scheduler coordinator binding is unavailable");
  const stub = namespace.get(namespace.idFromName(SCHEDULER_COORDINATOR_NAME));
  const response = await stub.fetch("https://scheduler.internal/wake", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: '{"names":["update_check"]}',
  });
  if (!response.ok) throw new Error(`scheduler coordinator wake failed: HTTP ${response.status}`);
  await response.body?.cancel();
}

// Keep the public ping inside the stateless HTTP CPU budget. It only wakes the
// SchedulerCoordinator Durable Object; manifest/R2/D1 work runs in the alarm
// invocation under the Durable Object CPU policy.
export function queueUpdateCheckPing(
  env: Env,
  ctx: ExecutionContext,
  now = Date.now(),
): boolean {
  if (!(env as UpdateCheckSchedulerEnv).SCHEDULER_COORDINATOR) return false;
  if (now - lastUpdatePingAt < UPDATE_PING_COOLDOWN_MS) return false;
  lastUpdatePingAt = now;
  ctx.waitUntil(signalUpdateCheck(env).catch(error => {
    lastUpdatePingAt = 0;
    console.error("update ping failed", error instanceof Error ? error.message : String(error));
  }));
  return true;
}

export function runUpdateCheck(env: Env): Promise<void> {
  return coalescedUpdateCheck(env);
}
