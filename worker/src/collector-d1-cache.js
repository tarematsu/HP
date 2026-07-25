const RAW_STATEMENT = Symbol('collector-d1-cache-raw-statement');
const STATEMENT_SQL = Symbol('collector-d1-cache-statement-sql');
const CACHED_DATABASE = Symbol('collector-d1-cache-database');

const DEFAULT_AUTH_CACHE_MS = 60 * 60_000;
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
  if (source.includes('FROM (SELECT ? AS id) requested')
      && source.includes('sh_worker_collector_state')
      && source.includes('sh_worker_auth_control')) return 'auth';
  if (/FROM sh_queue_materialization_state WHERE station_id\s*=\s*\?/i.test(source)) {
    return 'materialization';
  }
  if (/FROM sh_queue_current current WHERE current\.station_id IS \?/i.test(source)) {
    return 'queue-current';
  }
  return null;
}

function cacheDurationMs(category, env = {}) {
  if (category === 'auth') {
    return positiveInteger(env.COLLECTOR_D1_AUTH_CACHE_MS, DEFAULT_AUTH_CACHE_MS);
  }
  if (category === 'materialization') {
    return positiveInteger(
      env.COLLECTOR_D1_MATERIALIZATION_CACHE_MS,
      DEFAULT_MATERIALIZATION_CACHE_MS,
    );
  }
  return positiveInteger(
    env.COLLECTOR_D1_QUEUE_CURRENT_CACHE_MS,
    DEFAULT_QUEUE_CURRENT_CACHE_MS,
  );
}

function cacheKey(category, params, args) {
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

function invalidateForSql(state, sql) {
  if (isReadOnly(sql)) return;
  const source = normalizedSql(sql);
  if (/sh_worker_(?:collector_state|auth_control)/i.test(source)) clearCategory(state, 'auth');
  if (/sh_queue_materialization_state/i.test(source)) clearCategory(state, 'materialization');
  if (/sh_queue_(?:current|snapshots)/i.test(source)) clearCategory(state, 'queue-current');
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
          const now = Date.now();
          const key = cacheKey(category, params, args);
          const cached = state.cache.get(key);
          if (cached && cached.expires_at > now) return copyValue(cached.value);
          const value = await target.first(...args);
          state.cache.set(key, {
            value: copyValue(value),
            expires_at: now + cacheDurationMs(category, state.env),
          });
          return value;
        };
      }
      if (property === 'run') {
        return async (...args) => {
          const result = await target.run(...args);
          invalidateForSql(state, sql);
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
          for (const statement of source) invalidateForSql(state, statement?.[STATEMENT_SQL] || '');
          return result;
        };
      }
      if (property === 'exec') {
        return async (...args) => {
          const result = await target.exec(...args);
          state.cache.clear();
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
  if (db[CACHED_DATABASE]) return db;
  let state = databaseStates.get(db);
  if (!state) {
    state = { cache: new Map(), env, proxy: null };
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
