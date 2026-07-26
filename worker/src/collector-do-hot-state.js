const HOT_STATE_PREFIX = 'collector:hot:';

function enabled(value, fallback = true) {
  if (value == null || value === '') return fallback;
  return !/^(0|false|no|off)$/i.test(String(value).trim());
}

function copyValue(value) {
  if (Array.isArray(value)) return value.map(copyValue);
  if (value && typeof value === 'object') return { ...value };
  return value;
}

function hotStateApi(env = {}) {
  if (!enabled(env?.COLLECTOR_DO_HOT_STATE_ENABLED, true)) return null;
  const api = env?.__COLLECTOR_DO_HOT_STATE;
  return api && typeof api === 'object' ? api : null;
}

function storageKey(key) {
  return `${HOT_STATE_PREFIX}${String(key || '').trim()}`;
}

export async function getCollectorHotState(env, key) {
  const api = hotStateApi(env);
  if (typeof api?.get !== 'function') return null;
  try {
    return copyValue(await api.get(String(key || '')));
  } catch (error) {
    console.warn(JSON.stringify({
      event: 'collector_do_hot_state_read_failed',
      key: String(key || ''),
      error: String(error?.message || error).slice(0, 300),
    }));
    return null;
  }
}

export async function putCollectorHotState(env, key, value) {
  const api = hotStateApi(env);
  if (typeof api?.put !== 'function') return false;
  try {
    await api.put(String(key || ''), copyValue(value));
    return true;
  } catch (error) {
    console.warn(JSON.stringify({
      event: 'collector_do_hot_state_write_failed',
      key: String(key || ''),
      error: String(error?.message || error).slice(0, 300),
    }));
    return false;
  }
}

export async function mergeCollectorHotState(env, key, patch) {
  const current = await getCollectorHotState(env, key);
  return putCollectorHotState(env, key, {
    ...(current && typeof current === 'object' ? current : {}),
    ...(patch && typeof patch === 'object' ? patch : {}),
  });
}

export async function deleteCollectorHotState(env, key) {
  const api = hotStateApi(env);
  if (typeof api?.delete !== 'function') return false;
  try {
    await api.delete(String(key || ''));
    return true;
  } catch (error) {
    console.warn(JSON.stringify({
      event: 'collector_do_hot_state_delete_failed',
      key: String(key || ''),
      error: String(error?.message || error).slice(0, 300),
    }));
    return false;
  }
}

export function withCollectorDoHotState(env, storage) {
  if (!storage || !enabled(env?.COLLECTOR_DO_HOT_STATE_ENABLED, true)) return env;
  const active = Object.create(env || null);
  const api = Object.freeze({
    async get(key) {
      if (typeof storage.get !== 'function') return null;
      return storage.get(storageKey(key));
    },
    async put(key, value) {
      if (typeof storage.put !== 'function') return false;
      await storage.put(storageKey(key), value);
      return true;
    },
    async delete(key) {
      if (typeof storage.delete !== 'function') return false;
      await storage.delete(storageKey(key));
      return true;
    },
  });
  Object.defineProperty(active, '__COLLECTOR_DO_HOT_STATE', {
    value: api,
    enumerable: false,
    configurable: true,
  });
  return active;
}

export const COLLECTOR_DO_HOT_STATE = Object.freeze({
  prefix: HOT_STATE_PREFIX,
  auth_key: 'auth:stationhead',
});
