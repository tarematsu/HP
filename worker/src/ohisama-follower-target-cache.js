export const OHISAMA_FOLLOWER_TARGET_CACHE_KEY = 'stationhead/ohisama/follower-targets.json';
const CACHE_VERSION = 3;
const MAX_CACHED_HANDLES = 256;

function normalizedHandle(value) {
  const handle = String(value || '').trim().toLowerCase();
  return handle && handle.length <= 128 ? handle : null;
}

async function loadHandles(bucket) {
  if (typeof bucket?.get !== 'function') return new Set();
  try {
    const object = await bucket.get(OHISAMA_FOLLOWER_TARGET_CACHE_KEY);
    if (!object) return new Set();
    const value = typeof object.json === 'function'
      ? await object.json()
      : JSON.parse(await object.text());
    if (Number(value?.version) !== CACHE_VERSION || !Array.isArray(value?.handles)) return new Set();
    return new Set(value.handles.map(normalizedHandle).filter(Boolean));
  } catch {
    return new Set();
  }
}

async function saveHandles(bucket, handles, observedAt) {
  if (typeof bucket?.put !== 'function') return false;
  const values = [...handles].slice(-MAX_CACHED_HANDLES);
  await bucket.put(OHISAMA_FOLLOWER_TARGET_CACHE_KEY, JSON.stringify({
    version: CACHE_VERSION,
    updated_at: observedAt,
    handles: values,
  }), {
    httpMetadata: { contentType: 'application/json; charset=utf-8' },
    customMetadata: { version: String(CACHE_VERSION), updated_at: String(observedAt) },
  });
  return true;
}

// This cache suppresses only optional follower metadata/initial-sample work.
// Live target registration in OTHER_DB must stay outside this wrapper so a
// retained R2 cache entry can never hide a missing dynamic target row.
export function cachedOhisamaFollowerMetadataRegistrar(registerFollowerMetadata) {
  if (typeof registerFollowerMetadata !== 'function') {
    throw new TypeError('registerFollowerMetadata must be a function');
  }
  return async (env, snapshot, observedAt, session) => {
    const handle = normalizedHandle(snapshot?.host_handle);
    if (!handle) return false;

    const handles = await loadHandles(env?.PAGES_RESPONSE_R2);
    if (handles.has(handle)) return false;

    const changed = await registerFollowerMetadata(env, snapshot, observedAt, session);
    handles.add(handle);
    await saveHandles(env?.PAGES_RESPONSE_R2, handles, observedAt).catch(() => false);
    return changed;
  };
}

// Backwards-compatible export for tests/importers during rollout. Do not use
// this wrapper around authoritative D1 target registration.
export const cachedOhisamaFollowerTargetRegistrar = cachedOhisamaFollowerMetadataRegistrar;

export default {
  cachedOhisamaFollowerMetadataRegistrar,
  cachedOhisamaFollowerTargetRegistrar,
};
