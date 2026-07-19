import { DASHBOARD_SOURCE_NAMES } from "./snapshot";

export const SYNC_SOURCE_NAMES = [...DASHBOARD_SOURCE_NAMES, "radar", "stationhead_health"] as const;
export const SYNC_SOURCE_PLACEHOLDERS = SYNC_SOURCE_NAMES.map(() => "?").join(",");

export interface DeviceSyncVersionSummary {
  dashboard_version: number;
  radar_version: number;
  switchbot_version: number;
  stationhead_version: number;
  stationhead_health_version: number;
}

export function normalizeDeviceSyncVersions(
  row: Partial<DeviceSyncVersionSummary> | null | undefined,
): DeviceSyncVersionSummary {
  return {
    dashboard_version: Number(row?.dashboard_version ?? 0),
    radar_version: Number(row?.radar_version ?? 0),
    switchbot_version: Number(row?.switchbot_version ?? 0),
    stationhead_version: Number(row?.stationhead_version ?? 0),
    stationhead_health_version: Number(row?.stationhead_health_version ?? 0),
  };
}
