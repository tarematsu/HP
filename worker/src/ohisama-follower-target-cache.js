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

export function cachedOhisamaFollowerTargetRegistrar(registerFollowerTarget) {
  if (typeof registerFollowerTarget !== 'function') {
    throw new TypeError('registerFollowerTarget must be a function');
  }
  return async (env, snapshot, observedAt) => {
    const handle = normalizedHandle(snapshot?.host_handle);
    if (!handle) return false;

    const handles = await loadHandles(env?.PAGES_RESPONSE_R2);
    if (handles.has(handle)) return false;

    const added = await registerFollowerTarget(env, snapshot, observedAt);
    handles.add(handle);
    await saveHandles(env?.PAGES_RESPONSE_R2, handles, observedAt).catch(() => false);
    return added;
  };
}

export default {
  cachedOhisamaFollowerTargetRegistrar,
};
