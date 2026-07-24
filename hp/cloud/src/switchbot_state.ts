import { sendSwitchBotCommand } from "./switchbot_api";
import { SENSOR_TYPES } from "./switchbot_types";
import type { DeviceState, SwitchBotEnv, SwitchBotState } from "./switchbot_types";

export interface PresenceEvent {
  doorMode?: string | undefined;
  detectionState?: string | undefined;
}

export function deriveSwitchBotState(
  devices: DeviceState[],
  previous: SwitchBotState | null,
  now: number,
  exitConfirmSeconds: number,
  controlPlugIds: string[],
  event?: PresenceEvent,
): SwitchBotState {
  const contacts = devices.filter(device => device.deviceType === "Contact Sensor");
  const motionSensors = devices.filter(device => device.deviceType === "Motion Sensor" || device.deviceType === "Presence Sensor");
  const doorOpen = contacts.some(device => device.openState === "open" || device.openState === "timeOutNotClose");
  const motion = [...contacts, ...motionSensors].some(device => device.motion === true);
  const lightValues = [...contacts, ...motionSensors]
    .map(device => device.brightness)
    .filter((value): value is string => value !== null);
  const brightness: SwitchBotState["brightness"] = lightValues.includes("bright")
    ? "bright"
    : lightValues.includes("dim") ? "dim" : previous?.brightness ?? "unknown";

  let presence = previous?.presence ?? "unknown";
  let lastActivityAt = previous?.lastActivityAt ?? 0;
  let motionInactiveSince = previous?.motionInactiveSince ?? 0;
  let awayCandidateAt = previous?.awayCandidateAt ?? 0;
  const eventDoorMode = event?.doorMode ?? "";
  const eventDetection = event?.detectionState ?? "";
  const previousDoorOpen = previous?.doorOpen ?? false;

  if (motion) {
    motionInactiveSince = 0;
  } else if (previous?.motion === true || motionInactiveSince <= 0) {
    motionInactiveSince = now;
  }

  if (eventDoorMode === "IN_DOOR" || eventDetection === "DETECTED" || doorOpen || motion) {
    presence = "home";
    lastActivityAt = now;
    awayCandidateAt = 0;
  } else if (eventDoorMode === "OUT_DOOR" || (previousDoorOpen && !doorOpen)) {
    awayCandidateAt = now;
  }

  if (awayCandidateAt && !doorOpen && !motion && now - awayCandidateAt >= exitConfirmSeconds * 1000) {
    presence = "away";
  } else if (presence === "unknown" && devices.some(device => SENSOR_TYPES.has(device.deviceType))) {
    presence = "home";
  }

  return {
    provider: "SwitchBot OpenAPI v1.1",
    observedAt: now,
    presence,
    doorOpen,
    motion,
    motionReliable: true,
    brightness,
    lastActivityAt,
    motionInactiveSince,
    awayCandidateAt,
    lastPowerPollAt: previous?.lastPowerPollAt ?? 0,
    devices,
    controlPlugIds,
    serviceAvailable: true,
    degradedReason: null,
  };
}

export function failSafeSwitchBotState(
  previous: SwitchBotState | null,
  now: number,
  controlPlugIds: string[],
  reason: string,
): SwitchBotState {
  const brightness = previous?.brightness ?? "unknown";
  return {
    provider: "SwitchBot OpenAPI v1.1",
    observedAt: now,
    presence: "home",
    doorOpen: previous?.doorOpen ?? false,
    motion: previous?.motion ?? false,
    motionReliable: false,
    brightness,
    lastActivityAt: previous?.lastActivityAt ?? now,
    motionInactiveSince: previous?.motionInactiveSince ?? now,
    awayCandidateAt: 0,
    lastPowerPollAt: previous?.lastPowerPollAt ?? 0,
    devices: previous?.devices ?? [],
    controlPlugIds,
    serviceAvailable: false,
    degradedReason: reason.slice(0, 500),
  };
}

export async function applyAwayControls(env: SwitchBotEnv, previous: SwitchBotState | null, next: SwitchBotState): Promise<void> {
  if (previous?.presence === "away" || next.presence !== "away" || !next.controlPlugIds.length) return;
  const byId = new Map(next.devices.map(device => [device.deviceId.toUpperCase(), device]));
  const targets = next.controlPlugIds.filter(id => byId.get(id.toUpperCase())?.power?.toLowerCase() !== "off");
  await Promise.all(targets.map(id => sendSwitchBotCommand(env, id, "turnOff")));
}
