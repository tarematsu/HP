import { DEVICE_ID_PATTERN } from "./auth";
import { readState, updateState, type StateRow } from "./snapshot";
import type { Env } from "./sources";
import type { EnvironmentHistoryRow } from "./telemetry_bucket";

interface EnvironmentDeviceHistory {
  deviceId: string;
  bucketMinutes: number;
  history: EnvironmentHistoryRow[];
}

interface StoredEnvironmentRow extends EnvironmentHistoryRow {
  device_id: string;
}

const ENVIRONMENT_HISTORY_MS = 24 * 60 * 60 * 1000;

function previousSelectedDevice(previous: StateRow | null): string {
  if (!previous?.payload) return "";
  try {
    const parsed = JSON.parse(previous.payload) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return "";
    const deviceId = String((parsed as Record<string, unknown>).deviceId ?? "");
    return DEVICE_ID_PATTERN.test(deviceId) ? deviceId : "";
  } catch {
    return "";
  }
}

function nullableNumber(value: unknown, digits?: number): number | null {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return digits === undefined ? Math.round(number) : Number(number.toFixed(digits));
}

function normalizedPoint(row: EnvironmentHistoryRow, t: number): EnvironmentHistoryRow {
  return {
    t,
    co2: nullableNumber(row.co2),
    temperature: nullableNumber(row.temperature, 2),
    humidity: nullableNumber(row.humidity, 2),
  };
}

export async function mergeEnvironmentRows(
  env: Env,
  fallbackDeviceId: string,
  returnedRows: EnvironmentHistoryRow[],
  now: number,
): Promise<void> {
  const cutoff = now - ENVIRONMENT_HISTORY_MS;
  const stored = await env.DB.prepare(
    `SELECT device_id,bucket_at AS t,
       CASE WHEN co2_count>0 THEN co2_sum/co2_count ELSE NULL END AS co2,
       CASE WHEN temperature_count>0 THEN temperature_sum/temperature_count ELSE NULL END AS temperature,
       CASE WHEN humidity_count>0 THEN humidity_sum/humidity_count ELSE NULL END AS humidity
       FROM environment_buckets
      WHERE bucket_at>=?1
      ORDER BY device_id,bucket_at`,
  ).bind(cutoff).all<StoredEnvironmentRow>();

  const durableRows = stored.results ?? [];
  const useDurableRows = durableRows.length > 0;
  const rows: readonly EnvironmentHistoryRow[] = useDurableRows ? durableRows : returnedRows;
  const devices: Record<string, EnvironmentDeviceHistory> = {};
  const deviceList: EnvironmentDeviceHistory[] = [];
  let unorderedDevices: Set<string> | null = null;
  let firstDeviceId = "";
  for (const row of rows) {
    const deviceId = useDurableRows
      ? String((row as StoredEnvironmentRow).device_id ?? "")
      : fallbackDeviceId;
    const t = Number(row.t);
    if (!DEVICE_ID_PATTERN.test(deviceId) || !Number.isSafeInteger(t) || t < cutoff) continue;
    const point = normalizedPoint(row, t);
    let device = devices[deviceId];
    if (!device) {
      device = { deviceId, bucketMinutes: 5, history: [] };
      devices[deviceId] = device;
      deviceList.push(device);
      if (!firstDeviceId || deviceId < firstDeviceId) firstDeviceId = deviceId;
    } else if (device.history.length && device.history[device.history.length - 1]!.t > t) {
      (unorderedDevices ??= new Set<string>()).add(deviceId);
    }
    device.history.push(point);
  }
  if (unorderedDevices) {
    for (const deviceId of unorderedDevices) {
      devices[deviceId]!.history.sort((left, right) => left.t - right.t);
    }
  }

  const previous = await readState(env, "environment");
  const previousDeviceId = previousSelectedDevice(previous);
  const preferred = env.HOMEPANEL_PRIMARY_DEVICE_ID?.trim() ?? "";
  const selectedId = devices[preferred]
    ? preferred
    : devices[previousDeviceId]
      ? previousDeviceId
      : devices[fallbackDeviceId]
        ? fallbackDeviceId
        : firstDeviceId || fallbackDeviceId;
  const selected = devices[selectedId] ?? { deviceId: selectedId, bucketMinutes: 5, history: [] };
  await updateState(env, {
    source: "environment",
    observedAt: now,
    payload: {
      deviceId: selected.deviceId,
      bucketMinutes: selected.bucketMinutes,
      history: selected.history,
      devices,
    },
  }, undefined, previous);
}
