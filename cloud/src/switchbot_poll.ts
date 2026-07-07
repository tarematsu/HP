import type { Env, SourceResult } from "./sources";
import {
  configuredIds,
  loadSwitchBotSnapshot,
  normalizeDevice,
  switchBotApi,
} from "./switchbot_api";
import { switchBotWebhookUrl } from "./switchbot";
import { applyAwayControls, deriveSwitchBotState, failSafeSwitchBotState } from "./switchbot_state";
import { PLUG_TYPES, SENSOR_TYPES } from "./switchbot_types";
import type { ApiDevice } from "./switchbot_api";
import type { SwitchBotEnv } from "./switchbot_types";
import type { StateRow } from "./snapshot";

const WEBHOOK_RECHECK_MS = 6 * 60 * 60 * 1000;
const WEBHOOK_RETRY_MS = 15 * 60 * 1000;
let nextWebhookCheckAt = 0;

export type SwitchBotPollResult = SourceResult & { previousRow: StateRow | null };

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sensorStatusError(device: ApiDevice, status: Record<string, unknown>): string | null {
  const deviceType = device.deviceType ?? "";
  if (!SENSOR_TYPES.has(deviceType)) return null;
  if (device.enableCloudService === false) return "SwitchBot cloud service is disabled";

  const hasCurrentMotion = deviceType === "Presence Sensor"
    ? typeof status.Detected === "boolean"
    : typeof status.moveDetected === "boolean";
  return hasCurrentMotion ? null : "SwitchBot response is missing the current motion state";
}

async function ensureRuntimeWebhook(env: SwitchBotEnv): Promise<void> {
  const now = Date.now();
  if (now < nextWebhookCheckAt) return;
  nextWebhookCheckAt = now + WEBHOOK_RETRY_MS;

  try {
    const url = await switchBotWebhookUrl(env);
    if (!url) {
      nextWebhookCheckAt = now + WEBHOOK_RECHECK_MS;
      return;
    }
    const result = await switchBotApi<{ urls?: string[] }>(env, "/webhook/queryWebhook", {
      method: "POST",
      body: JSON.stringify({ action: "queryUrl" }),
    });
    const urls = Array.isArray(result.urls) ? result.urls : [];
    if (urls.includes(url)) {
      await switchBotApi(env, "/webhook/updateWebhook", {
        method: "POST",
        body: JSON.stringify({ action: "updateWebhook", config: { url, enable: true } }),
      });
    } else {
      await switchBotApi(env, "/webhook/setupWebhook", {
        method: "POST",
        body: JSON.stringify({ action: "setupWebhook", url, deviceList: "ALL" }),
      });
    }
    nextWebhookCheckAt = now + WEBHOOK_RECHECK_MS;
  } catch (error) {
    console.error("SwitchBot runtime webhook verification failed", errorText(error));
  }
}

export async function fetchSwitchBotOptimized(baseEnv: Env): Promise<SwitchBotPollResult> {
  const env = baseEnv as SwitchBotEnv;
  await ensureRuntimeWebhook(env);

  const now = Date.now();
  const snapshot = await loadSwitchBotSnapshot(env);
  const previous = snapshot.state;
  const controlPlugIds = configuredIds(env.SWITCHBOT_CONTROL_PLUG_IDS);
  const exitConfirmSeconds = Math.max(30, Number(env.SWITCHBOT_EXIT_CONFIRM_SECONDS) || 60);
  const fallbackSeconds = Math.max(60, Number(env.SWITCHBOT_FALLBACK_POLL_SECONDS) || 300);
  const wrap = (payload: unknown): SwitchBotPollResult => ({
    source: "switchbot",
    payload,
    observedAt: now,
    previousRow: snapshot.row,
  });

  if (previous && now - previous.lastPowerPollAt < fallbackSeconds * 1000) {
    if (previous.serviceAvailable === false || previous.motionReliable !== true) {
      return wrap(failSafeSwitchBotState(
        previous,
        now,
        controlPlugIds,
        previous.degradedReason ?? "SwitchBot motion state unavailable",
      ));
    }
    const next = deriveSwitchBotState(previous.devices, previous, now, exitConfirmSeconds, controlPlugIds);
    await applyAwayControls(env, previous, next);
    return wrap(next);
  }

  let response: { deviceList?: ApiDevice[] };
  try {
    response = await switchBotApi<{ deviceList?: ApiDevice[] }>(env, "/devices");
  } catch (error) {
    return wrap(failSafeSwitchBotState(previous, now, controlPlugIds, errorText(error)));
  }

  const devices = (response.deviceList ?? []).filter(device =>
    SENSOR_TYPES.has(device.deviceType ?? "") || PLUG_TYPES.has(device.deviceType ?? ""));
  const previousById = new Map((previous?.devices ?? []).map(device => [device.deviceId, device]));
  const normalized = await Promise.all(devices.map(async device => {
    const prior = previousById.get(device.deviceId) ?? null;
    try {
      const status = await switchBotApi<Record<string, unknown>>(env, `/devices/${encodeURIComponent(device.deviceId)}/status`);
      const result = normalizeDevice(device, status, prior);
      result.error = sensorStatusError(device, status);
      return result;
    } catch (error) {
      const fallback = normalizeDevice(device, {}, prior);
      fallback.error = errorText(error);
      return fallback;
    }
  }));

  const sensors = normalized.filter(device => SENSOR_TYPES.has(device.deviceType));
  const failedSensors = sensors.filter(device => device.error);
  if (!sensors.length || failedSensors.length) {
    const reason = !sensors.length
      ? "No SwitchBot presence sensor is available"
      : `SwitchBot sensor status unavailable: ${failedSensors.map(device => device.deviceName).join(", ")}`;
    const base = previous ? { ...previous, devices: normalized, lastPowerPollAt: now } : null;
    const next = failSafeSwitchBotState(base, now, controlPlugIds, reason);
    next.devices = normalized;
    next.lastPowerPollAt = now;
    return wrap(next);
  }

  const next = deriveSwitchBotState(normalized, previous, now, exitConfirmSeconds, controlPlugIds);
  next.lastPowerPollAt = now;
  await applyAwayControls(env, previous, next);
  return wrap(next);
}
