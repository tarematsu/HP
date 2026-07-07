import { configuredIds, loadSwitchBotSnapshot } from "./switchbot_api";
import { applyAwayControls, deriveSwitchBotState } from "./switchbot_state";
import { updateState } from "./snapshot";
import type { Env } from "./sources";
import type { DeviceState, SwitchBotEnv } from "./switchbot_types";

interface SwitchBotEvent {
  eventType?: string;
  context?: Record<string, unknown>;
}

const WEBHOOK_TYPES = new Set([
  "WoPresence",
  "WoContact",
  "Presence Sensor",
  "WoPlugUS",
  "WoPlugJP",
  "WoPlugEU",
]);

let webhookSecret = "";
let webhookTokenCache = "";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

function publicWorkerUrl(env: Env): string {
  const configured = env.HOMEPANEL_PUBLIC_URL?.trim() ?? "";
  if (!configured) return "";
  try {
    const url = new URL(configured);
    url.pathname = url.pathname.replace(/\/+$/, "");
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

function sampleTime(value: unknown): number {
  const parsed = numberValue(value);
  if (parsed === null || parsed <= 0) return Date.now();
  return parsed < 1_000_000_000_000 ? parsed * 1000 : parsed;
}

function eventDeviceType(value: string): string {
  switch (value) {
    case "WoPresence": return "Motion Sensor";
    case "WoContact": return "Contact Sensor";
    case "WoPlugJP": return "Plug Mini (JP)";
    case "WoPlugUS": return "Plug Mini (US)";
    case "WoPlugEU": return "Plug Mini (EU)";
    default: return value;
  }
}

function emptyDevice(deviceId: string, deviceType: string): DeviceState {
  return {
    deviceId,
    deviceName: deviceId,
    deviceType,
    hubDeviceId: null,
    cloudEnabled: null,
    battery: null,
    motion: null,
    openState: null,
    doorMode: null,
    brightness: null,
    power: null,
    watts: null,
    voltage: null,
    electricCurrent: null,
    onlineStatus: null,
    observedAt: 0,
    error: null,
  };
}

export async function webhookToken(baseEnv: Env): Promise<string> {
  const secret = (baseEnv as SwitchBotEnv).SWITCHBOT_SECRET?.trim() ?? "";
  if (!secret) return "";
  if (webhookSecret === secret && webhookTokenCache) return webhookTokenCache;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${secret}:homepanel-webhook`));
  webhookTokenCache = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("").slice(0, 32);
  webhookSecret = secret;
  return webhookTokenCache;
}

export async function switchBotWebhookUrl(baseEnv: Env): Promise<string> {
  const token = await webhookToken(baseEnv);
  const workerUrl = publicWorkerUrl(baseEnv);
  return token && workerUrl ? `${workerUrl}/v1/switchbot/webhook/${token}` : "";
}

export async function handleSwitchBotWebhook(request: Request, baseEnv: Env): Promise<Response> {
  const env = baseEnv as SwitchBotEnv;
  let event: SwitchBotEvent;
  try {
    event = await request.json() as SwitchBotEvent;
  } catch {
    return new Response("invalid json", { status: 400 });
  }

  const context = asRecord(event.context);
  const rawType = text(context.deviceType);
  if (event.eventType !== "changeReport" || !WEBHOOK_TYPES.has(rawType)) {
    return new Response(null, { status: 204 });
  }

  const deviceId = text(context.deviceMac).trim();
  if (!deviceId) return new Response("missing device", { status: 400 });

  const now = sampleTime(context.timeOfSample);
  const snapshot = await loadSwitchBotSnapshot(env);
  const previous = snapshot.state;
  const devices = [...(previous?.devices ?? [])];
  const index = devices.findIndex(device => device.deviceId.toUpperCase() === deviceId.toUpperCase());
  const current = index >= 0 ? devices[index]! : emptyDevice(deviceId, eventDeviceType(rawType));
  const detectionState = text(context.detectionState);
  const updated: DeviceState = {
    ...current,
    deviceType: eventDeviceType(rawType),
    battery: numberValue(context.battery) ?? current.battery,
    motion: detectionState === "DETECTED" ? true : detectionState === "NOT_DETECTED" ? false : current.motion,
    openState: text(context.openState) || current.openState,
    doorMode: text(context.doorMode) || current.doorMode,
    brightness: text(context.brightness) || current.brightness,
    power: text(context.powerState) || current.power,
    observedAt: now,
    error: null,
  };
  if (index >= 0) devices[index] = updated;
  else devices.push(updated);

  const exitConfirmSeconds = Math.max(30, Number(env.SWITCHBOT_EXIT_CONFIRM_SECONDS) || 60);
  const controlPlugIds = configuredIds(env.SWITCHBOT_CONTROL_PLUG_IDS);
  const next = deriveSwitchBotState(devices, previous, now, exitConfirmSeconds, controlPlugIds, {
    doorMode: updated.doorMode ?? undefined,
    detectionState: detectionState || undefined,
  });
  await applyAwayControls(env, previous, next);
  await updateState(env, { source: "switchbot", payload: next, observedAt: now }, undefined, snapshot.row);
  return new Response(null, { status: 204 });
}
