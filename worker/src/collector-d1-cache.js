import {
  getCollectorHotState,
  putCollectorHotState,
} from './collector-do-hot-state.js';

const RAW_STATEMENT = Symbol('collector-d1-cache-raw-statement');
const STATEMENT_SQL = Symbol('collector-d1-cache-statement-sql');
const CACHED_DATABASE = Symbol('collector-d1-cache-database');

const DEFAULT_AUTH_CACHE_MS = 6 * 60 * 60_000;
const DEFAULT_QUEUE_CURRENT_CACHE_MS = 60 * 60_000;
const DEFAULT_MATERIALIZATION_CACHE_MS = 5 * 60_000;
const MAX_CACHE_MS = 6 * 60 * 60_000;
const databaseStates = new WeakMap();

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && Math.trunc(parsed) > 0
    ? Math.min(Math.trunc(parsed), MAX_CACHE_MS)
    : fallback;
}

function normalizedSql(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function readCategory(sql) {
  const source = normalizedSql(sql);
  if (/FROM sh_queue_materialization_state WHERE station_id\s*=\s*\?/i.test(source)) {
    return 'materialization';
  }
  if (/FROM sh_queue_current current WHERE current\.station_id IS \?/i.test(source)) {
    return 'queue-current';
  }
  if (/LEFT JOIN sh_worker_collector_state collector_state[\s\S]*LEFT JOIN sh_worker_auth_control auth_control/i.test(source)) {
    return 'auth-state';
  }
  return null;
}

function cacheDurationMs(category, env = {}) {
  if (category === 'materialization') {
    return positiveInteger(
      env.COLLECTOR_D1_MATERIALIZATION_CACHE_MS,
      DEFAULT_MATERIALIZATION_CACHE_MS,
    );
  }
  if (category === 'auth-state') {
    return positiveInteger(env.COLLECTOR_D1_AUTH_CACHE_MS, DEFAULT_AUTH_CACHE_MS);
  }
  return positiveInteger(
    env.COLLECTOR_D1_QUEUE_CURRENT_CACHE_MS,
    DEFAULT_QUEUE_CURRENT_CACHE_MS,
  );
}

function cacheIdentity(category, params, args) {
  return `${category}:${JSON.stringify([params, args])}`;
}

function copyValue(value) {
  if (Array.isArray(value)) return value.map(copyValue);
  if (value && typeof value === 'object') return { ...value };
  return value;
}

function clearCategory(state, category) {
  for (const key of state.cache.keys()) {
    if (key.startsWith(`${category}:`)) state.cache.delete(key);
  }
}

function isReadOnly(sql) {
  return /^\s*(?:SELECT|PRAGMA|EXPLAIN)\b/i.test(String(sql || ''));
}

function invalidatedCategories(sql) {
  if (isReadOnly(sql)) return [];
  const source = normalizedSql(sql);
  const categories = [];
  if (/sh_queue_materialization_state/i.test(source)) categories.push('materialization');
  if (/sh_queue_(?:current|snapshots)/i.test(source)) categories.push('queue-current');
  if (/sh_worker_(?:collector_state|auth_control)/i.test(source)) categories.push('auth-state');
  return categories;
}

async function generation(state, category) {
  if (state.generations.has(category)) return state.generations.get(category);
  const stored = await getCollectorHotState(state.env, `d1-cache-generation:${category}`);
  const value = Math.max(0, Math.trunc(Number(stored?.value ?? stored) || 0));
  state.generations.set(category, value);
  return value;
}

async function invalidateForSql(state, sql) {
  for (const category of invalidatedCategories(sql)) {
    clearCategory(state, category);
    const next = (await generation(state, category)) + 1;
    state.generations.set(category, next);
    await putCollectorHotState(state.env, `d1-cache-generation:${category}`, { value: next });
  }
}

async function persistentCacheEntry(state, identity, category) {
  const version = await generation(state, category);
  const key = `d1-cache:${version}:${identity}`;
  const entry = await getCollectorHotState(state.env, key);
  return { key, entry };
}

async function readCached(state, identity, category) {
  const now = Date.now();
  const memory = state.cache.get(identity);
  if (memory && memory.expires_at > now) return { hit: true, value: copyValue(memory.value) };
  const { key, entry } = await persistentCacheEntry(state, identity, category);
  if (!entry || Number(entry.expires_at || 0) <= now) return { hit: false, key };
  state.cache.set(identity, {
    value: copyValue(entry.value),
    expires_at: Number(entry.expires_at),
  });
  return { hit: true, value: copyValue(entry.value), key };
}

async function writeCached(state, identity, category, value, key = null) {
  const expiresAt = Date.now() + cacheDurationMs(category, state.env);
  const entry = { value: copyValue(value), expires_at: expiresAt };
  state.cache.set(identity, entry);
  const persistentKey = key || (await persistentCacheEntry(state, identity, category)).key;
  await putCollectorHotState(state.env, persistentKey, entry);
}

function wrapStatement(statement, sql, params, state) {
  return new Proxy(statement, {
    get(target, property) {
      if (property === RAW_STATEMENT) return target;
      if (property === STATEMENT_SQL) return sql;
      if (property === 'bind') {
        return (...values) => wrapStatement(target.bind(...values), sql, values, state);
      }
      if (property === 'first') {
        return async (...args) => {
          const category = readCategory(sql);
          if (!category) return target.first(...args);
          const identity = cacheIdentity(category, params, args);
          const cached = await readCached(state, identity, category);
          if (cached.hit) return cached.value;
          const value = await target.first(...args);
          await writeCached(state, identity, category, value, cached.key);
          return value;
        };
      }
      if (property === 'run') {
        return async (...args) => {
          const result = await target.run(...args);
          await invalidateForSql(state, sql);
          return result;
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

function createDatabaseProxy(db, state) {
  return new Proxy(db, {
    get(target, property) {
      if (property === CACHED_DATABASE) return true;
      if (property === 'prepare') {
        return (sql) => wrapStatement(target.prepare(sql), String(sql || ''), [], state);
      }
      if (property === 'batch') {
        return async (statements) => {
          const source = Array.isArray(statements) ? statements : [];
          const result = await target.batch(source.map((statement) => statement?.[RAW_STATEMENT] || statement));
          for (const statement of source) {
            await invalidateForSql(state, statement?.[STATEMENT_SQL] || '');
          }
          return result;
        };
      }
      if (property === 'exec') {
        return async (...args) => {
          const result = await target.exec(...args);
          state.cache.clear();
          state.generations.clear();
          return result;
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

export function collectorCachedDb(db, env = {}) {
  if (!db || (typeof db !== 'object' && typeof db !== 'function')) return db;
  if (typeof db.prepare !== 'function') return db;
  if (db[CACHED_DATABASE]) return db;
  let state = databaseStates.get(db);
  if (!state) {
    state = { cache: new Map(), generations: new Map(), env, proxy: null };
    state.proxy = createDatabaseProxy(db, state);
    databaseStates.set(db, state);
  } else {
    state.env = env;
  }
  return state.proxy;
}

export function resetCollectorD1CacheForTests(db) {
  if (db && databaseStates.has(db)) databaseStates.delete(db);
}

export const COLLECTOR_D1_CACHE_DEFAULTS = Object.freeze({
  auth_ms: DEFAULT_AUTH_CACHE_MS,
  queue_current_ms: DEFAULT_QUEUE_CURRENT_CACHE_MS,
  materialization_ms: DEFAULT_MATERIALIZATION_CACHE_MS,
});
