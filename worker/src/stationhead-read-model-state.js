import { loadMaterializedR2Json } from './pages-response-r2.js';

const FIVE_MINUTES_MS = 5 * 60_000;
const DAY_MS = 24 * 60 * 60_000;

export const STATIONHEAD_READ_MODEL_INCREMENTAL_GAP_MS = 11 * 60_000;
export const STATIONHEAD_READ_MODEL_RECOVERY_GAP_MS = DAY_MS;

export function stationheadFiveMinuteBucket(timestamp) {
  const value = Number(timestamp);
  return Number.isFinite(value) ? Math.floor(value / FIVE_MINUTES_MS) * FIVE_MINUTES_MS : null;
}

export async function readStationheadJsonObject(bucket, key) {
  if (!key || typeof bucket?.get !== 'function') return null;
  try {
    const object = await bucket.get(key);
    if (!object) return null;
    if (typeof object.json === 'function') return await object.json();
    if (typeof object.text === 'function') return JSON.parse(await object.text());
    return null;
  } catch {
    return null;
  }
}

export async function loadStationheadReadModelState(
  bucket,
  {
    hotKey,
    modelKey,
    upgrade = (value) => value,
    acceptPublic = () => true,
  } = {},
) {
  const hot = await readStationheadJsonObject(bucket, hotKey);
  if (Number(hot?.version) === 1) {
    const payload = upgrade(hot?.payload);
    if (payload) return { payload, source: 'hot' };
  }

  if (!modelKey) return { payload: null, source: 'none' };
  const publicPayload = await loadMaterializedR2Json(bucket, modelKey).catch(() => null);
  const upgraded = upgrade(publicPayload);
  if (!upgraded || !acceptPublic(publicPayload, upgraded)) {
    return { payload: null, source: 'none' };
  }
  return { payload: upgraded, source: 'public' };
}

export async function saveStationheadReadModelHotState(
  bucket,
  hotKey,
  payload,
  updatedAt,
  { modelKey = null } = {},
) {
  if (!hotKey || typeof bucket?.put !== 'function') return false;
  await bucket.put(hotKey, JSON.stringify({
    version: 1,
    updated_at: updatedAt,
    payload,
  }), {
    httpMetadata: { contentType: 'application/json; charset=utf-8' },
    customMetadata: {
      version: '1',
      updated_at: String(updatedAt),
      ...(modelKey ? { model_key: String(modelKey) } : {}),
    },
  });
  return true;
}

export function stationheadReadModelGapMode(
  previousAt,
  currentAt,
  {
    incrementalGapMs = STATIONHEAD_READ_MODEL_INCREMENTAL_GAP_MS,
    recoveryGapMs = STATIONHEAD_READ_MODEL_RECOVERY_GAP_MS,
  } = {},
) {
  const previous = Number(previousAt);
  const current = Number(currentAt);
  if (!Number.isFinite(previous) || !Number.isFinite(current) || current < previous) {
    return 'bootstrap';
  }
  const gap = current - previous;
  if (gap <= incrementalGapMs) return 'incremental';
  if (gap <= recoveryGapMs) return 'recovery';
  return 'bootstrap';
}
