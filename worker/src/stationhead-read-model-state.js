import {
  STATIONHEAD_READ_MODEL_INCREMENTAL_GAP_MS,
  STATIONHEAD_READ_MODEL_RECOVERY_GAP_MS,
  stationheadFiveMinuteBucket,
  stationheadReadModelGapMode,
  stationheadReadModelKey,
} from '../../packages/sh-shared/stationhead-read-models.mjs';
import { stationheadSourceProfile } from '../../packages/sh-shared/stationhead-source.mjs';
import { loadMaterializedR2Json } from './pages-response-r2.js';

export {
  STATIONHEAD_READ_MODEL_INCREMENTAL_GAP_MS,
  STATIONHEAD_READ_MODEL_RECOVERY_GAP_MS,
  stationheadFiveMinuteBucket,
  stationheadReadModelGapMode,
};

export function stationheadReadModelDescriptor(sourceValue) {
  const profile = stationheadSourceProfile(sourceValue);
  if (!profile) return null;
  return {
    source: profile.source,
    modelKey: stationheadReadModelKey(profile.source),
    hotKey: profile.readModelHotKey,
  };
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
    source = null,
    hotKey = stationheadReadModelDescriptor(source)?.hotKey,
    modelKey = stationheadReadModelDescriptor(source)?.modelKey,
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
  if (!upgraded || !acceptPublic(publicPayload, upgraded)) return { payload: null, source: 'none' };
  return { payload: upgraded, source: 'public' };
}

export async function saveStationheadReadModelHotState(
  bucket,
  hotKey,
  payload,
  updatedAt,
  { modelKey = null, source = null } = {},
) {
  const descriptor = stationheadReadModelDescriptor(source);
  const activeHotKey = hotKey || descriptor?.hotKey;
  const activeModelKey = modelKey || descriptor?.modelKey;
  if (!activeHotKey || typeof bucket?.put !== 'function') return false;
  await bucket.put(activeHotKey, JSON.stringify({
    version: 1,
    updated_at: updatedAt,
    payload,
  }), {
    httpMetadata: { contentType: 'application/json; charset=utf-8' },
    customMetadata: {
      version: '1',
      updated_at: String(updatedAt),
      ...(activeModelKey ? { model_key: String(activeModelKey) } : {}),
      ...(descriptor?.source ? { source: descriptor.source } : {}),
    },
  });
  return true;
}
