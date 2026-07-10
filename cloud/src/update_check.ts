import { configuredDeviceTokens, DEVICE_ID_PATTERN } from "./auth";
import { enqueueCommandOnce } from "./device_control";
import { readState, updateState } from "./snapshot";
import { readUpdateManifestIdentity } from "./update_proxy";
import type { Env } from "./sources";

const HEARTBEAT_WINDOW_MS = 30 * 86_400_000;
const COMMAND_TTL_SECONDS = 86_400;

// Every device this deployment knows about: statically configured tokens,
// the primary device, and anything that sent telemetry recently.
async function knownDeviceIds(env: Env): Promise<string[]> {
  const ids = new Set<string>();
  for (const deviceId of configuredDeviceTokens(env)?.keys() ?? []) ids.add(deviceId);
  const primary = env.HOMEPANEL_PRIMARY_DEVICE_ID?.trim() ?? "";
  if (DEVICE_ID_PATTERN.test(primary)) ids.add(primary);
  const rows = await env.DB.prepare(
    "SELECT device_id FROM device_heartbeats WHERE last_seen_at >= ?1",
  ).bind(Date.now() - HEARTBEAT_WINDOW_MS).all<{ device_id: string }>();
  for (const row of rows.results ?? []) {
    if (DEVICE_ID_PATTERN.test(row.device_id)) ids.add(row.device_id);
  }
  return [...ids];
}

// CI pings this endpoint right after publishing a release so the rollout
// starts immediately. The ping itself carries no trusted data and needs no
// authentication: the Worker re-reads the manifest from R2 and only a real
// manifest identity change queues device commands, so the worst an abuser can
// cause is one throttled R2/D1 read per minute per isolate.
let lastUpdatePingAt = 0;

export function queueUpdateCheckPing(env: Env, ctx: ExecutionContext): boolean {
  const now = Date.now();
  if (now - lastUpdatePingAt < 60_000) return false;
  lastUpdatePingAt = now;
  ctx.waitUntil(runUpdateCheck(env).catch(error =>
    console.error("update ping failed", error instanceof Error ? error.message : String(error))));
  return true;
}

// Cloud-driven auto update: whenever the published release identity changes,
// queue a check_update command for every known device. The identity includes a
// hash of the validated manifest, so correcting a broken publication under the
// same version still reaches devices.
export async function runUpdateCheck(env: Env): Promise<void> {
  if (!env.UPDATE_BUCKET) return;
  const identity = await readUpdateManifestIdentity(env);
  const previous = await readState(env, "update");
  let previousVersion = "";
  let previousManifestHash = "";
  try {
    const value = JSON.parse(previous?.payload ?? "{}") as {
      version?: unknown;
      manifestHash?: unknown;
    };
    previousVersion = String(value.version ?? "");
    previousManifestHash = String(value.manifestHash ?? "");
  } catch { /* treat unreadable state as no baseline */ }
  if (identity.version === previousVersion && identity.manifestHash === previousManifestHash) return;

  // The very first run only records a baseline so a fresh deployment does not
  // command-blast every device for a release they may already run. An older
  // version-only baseline deliberately triggers one check so it upgrades to
  // hash-aware tracking and can repair same-version publications thereafter.
  if (previousVersion) {
    const payload = JSON.stringify({
      reason: "release",
      version: identity.version,
      manifestHash: identity.manifestHash,
    });
    for (const deviceId of await knownDeviceIds(env)) {
      await enqueueCommandOnce(env, deviceId, "check_update", payload, COMMAND_TTL_SECONDS);
    }
  }
  // Enqueue before recording: if recording fails the next run re-enqueues,
  // and enqueueCommandOnce deduplicates identical pending commands.
  await updateState(env, {
    source: "update",
    payload: identity,
    observedAt: Date.now(),
  });
}
