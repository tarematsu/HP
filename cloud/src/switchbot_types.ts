import type { Env } from "./sources";

export type SwitchBotEnv = Env & {
  SWITCHBOT_CONTROL_PLUG_IDS?: string;
  SWITCHBOT_EXIT_CONFIRM_SECONDS?: string;
  SWITCHBOT_FALLBACK_POLL_SECONDS?: string;
};

export interface DeviceState {
  deviceId: string;
  deviceName: string;
  deviceType: string;
  hubDeviceId: string | null;
  cloudEnabled: boolean | null;
  battery: number | null;
  motion: boolean | null;
  openState: string | null;
  doorMode: string | null;
  brightness: string | null;
  power: string | null;
  watts: number | null;
  voltage: number | null;
  electricCurrent: number | null;
  onlineStatus: string | null;
  observedAt: number;
  error: string | null;
}

export interface SwitchBotState {
  provider: "SwitchBot OpenAPI v1.1";
  observedAt: number;
  presence: "unknown" | "home" | "away";
  doorOpen: boolean;
  motion: boolean;
  motionReliable?: boolean;
  brightness: "bright" | "dim" | "unknown";
  lastActivityAt: number;
  motionInactiveSince?: number;
  awayCandidateAt: number;
  lastPowerPollAt: number;
  devices: DeviceState[];
  controlPlugIds: string[];
  serviceAvailable?: boolean;
  degradedReason?: string | null;
}

export const SENSOR_TYPES = new Set(["Motion Sensor", "Contact Sensor", "Presence Sensor"]);
export const PLUG_TYPES = new Set(["Plug", "Plug Mini (US)", "Plug Mini (JP)", "Plug Mini (EU)"]);
