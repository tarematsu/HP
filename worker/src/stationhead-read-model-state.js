import {
  STATIONHEAD_READ_MODEL_INCREMENTAL_GAP_MS,
  STATIONHEAD_READ_MODEL_RECOVERY_GAP_MS,
  stationheadFiveMinuteBucket,
  stationheadReadModelGapMode,
  stationheadReadModelKey,
} from '../../packages/sh-shared/stationhead-read-models.mjs';
import { stationheadSourceProfile } from '../../packages/sh-shared/stationhead-source.mjs';
import { loadMaterializedR2Json, saveMaterializedR2Response } from './pages-response-r2.js';

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
  if (!key) return null;
  if (typeof bucket?.get !== 'function') {
    throw new Error('Stationhead read-model R2 binding is missing');
  }
  // Missing objects may bootstrap; transient R2 failures must not silently
  // become empty state and trigger a destructive rebuild.
  const object = await bucket.get(key);
  if (!object) return null;
  try {
    if (typeof object.json === 'function') return await object.json();
    if (typeof object.text === 'function') return JSON.parse(await object.text());
    return null;
  } catch (error) {
    // Invalid JSON can fall back to the public model; body transport failures
    // must retain the same fail-closed behavior as bucket.get failures.
    if (!(error instanceof SyntaxError)) throw error;
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
  const publicPayload = await loadMaterializedR2Json(bucket, modelKey);
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

/** One source-scoped public R2 writer for both Stationhead dashboards. */
export async function publishStationheadReadModel(bucket, sourceValue, payload, updatedAt, { headers = {}, metadata = {} } = {}) {
  const profile = stationheadSourceProfile(sourceValue);
  if (!profile) throw new Error(`unsupported Stationhead source: ${String(sourceValue || '<empty>')}`);
  return saveMaterializedR2Response(
    bucket, profile.modelKey, JSON.stringify(payload), 200, headers,
    updatedAt, profile.publicationCadenceSeconds,
    { ...metadata, model_key: profile.modelKey },
  );
}
