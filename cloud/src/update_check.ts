import { configuredDeviceTokens, DEVICE_ID_PATTERN } from "./auth";
import { enqueueCommandOnce } from "./device_control";
import { readState, updateState } from "./snapshot";
import { readUpdateManifestVersion } from "./update_proxy";
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

// Cloud-driven auto update: whenever the published release version changes,
// queue a check_update command for every known device. The device executes it
// on its next sync through the existing verified-updater path (manifest
// download, SHA-256/Authenticode checks, staged updater, restart).
export async function runUpdateCheck(env: Env): Promise<void> {
  if (!env.UPDATE_BUCKET) return;
  const version = await readUpdateManifestVersion(env);
  const previous = await readState(env, "update");
  let previousVersion = "";
  try {
    previousVersion = String((JSON.parse(previous?.payload ?? "{}") as { version?: unknown }).version ?? "");
  } catch { /* treat unreadable state as no baseline */ }
  if (version === previousVersion) return;

  // The very first run only records a baseline so a fresh deployment does not
  // command-blast every device for a release they may already run.
  if (previousVersion) {
    const payload = JSON.stringify({ reason: "release", version });
    for (const deviceId of await knownDeviceIds(env)) {
      await enqueueCommandOnce(env, deviceId, "check_update", payload, COMMAND_TTL_SECONDS);
    }
  }
  // Enqueue before recording: if recording fails the next run re-enqueues,
  // and enqueueCommandOnce deduplicates identical pending commands.
  await updateState(env, { source: "update", payload: { version }, observedAt: Date.now() });
}
