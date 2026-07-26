import { withMinuteD1WriteThrottling } from './minute-d1-write-throttle.js';
import { combinedAbortSignal } from './request-signal.js';

const DEFAULT_TIMEOUT_MS = 12_000;
const RAW_STATEMENT = Symbol('minute-fact-raw-statement');

function signalFrom(value) {
  if (value && typeof value.aborted === 'boolean') return value;
  return value?.__COLLECTION_ABORT_SIGNAL || null;
}

export function minuteFactTimeoutDisabled(value) {
  if (value === false || value === 0) return true;
  return /^(0|false|off|disabled)$/i.test(String(value ?? '').trim());
}

function configuredTimeout(env) {
  let current = env;
  let nearest = undefined;
  while (current) {
    if (Object.hasOwn(current, 'MINUTE_FACT_TIMEOUT_MS')) {
      const value = current.MINUTE_FACT_TIMEOUT_MS;
      // A parent runtime environment may explicitly disable deadlines while a
      // derive wrapper adds a per-job timeout on a child object. The explicit
      // disable must win so Queue consumers do not reject an in-flight D1 call.
      if (minuteFactTimeoutDisabled(value)) return value;
      if (nearest === undefined) nearest = value;
    }
    current = Object.getPrototypeOf(current);
  }
  return nearest ?? DEFAULT_TIMEOUT_MS;
}

function abortError(signal) {
  if (signal?.reason instanceof Error) return signal.reason;
  return Object.assign(new Error('minute fact write aborted'), { name: 'AbortError', code: 'MINUTE_FACT_ABORTED' });
}

export function throwIfMinuteFactAborted(value) {
  const signal = signalFrom(value);
  if (signal?.aborted) throw abortError(signal);
}

function wrapStatement(statement, signal) {
  return new Proxy(statement, {
    get(target, property, receiver) {
      if (property === RAW_STATEMENT) return target;
      if (property === 'bind') return (...args) => wrapStatement(target.bind(...args), signal);
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== 'function') return value;
      if (!['first', 'run', 'all', 'raw'].includes(String(property))) return value.bind(target);
      return async (...args) => {
        throwIfMinuteFactAborted(signal);
        const result = await value.apply(target, args);
        throwIfMinuteFactAborted(signal);
        return result;
      };
    },
  });
}

export function withAbortableMinuteFactD1(db, signal) {
  if (!db || !signal) return db;
  return new Proxy(db, {
    get(target, property, receiver) {
      if (property === 'prepare') return (sql) => {
        throwIfMinuteFactAborted(signal);
        return wrapStatement(target.prepare(sql), signal);
      };
      if (property === 'batch') return async (statements) => {
        throwIfMinuteFactAborted(signal);
        const result = await target.batch((statements || []).map((statement) => statement?.[RAW_STATEMENT] || statement));
        throwIfMinuteFactAborted(signal);
        return result;
      };
      const value = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

function boundedEnv(env, signal) {
  const active = Object.create(env || null);
  Object.defineProperties(active, {
    __COLLECTION_ABORT_SIGNAL: {
      value: signal,
      enumerable: true,
      configurable: true,
    },
    DB: {
      value: withAbortableMinuteFactD1(env?.DB, signal),
      enumerable: true,
      configurable: true,
    },
    MINUTE_DB: {
      value: withAbortableMinuteFactD1(env?.MINUTE_DB, signal),
      enumerable: true,
      configurable: true,
    },
  });
  return active;
}

function rejectedWhenAborted(signal) {
  return new Promise((_, reject) => {
    if (signal.aborted) { reject(abortError(signal)); return; }
    signal.addEventListener('abort', () => reject(abortError(signal)), { once: true });
  });
}

export async function saveMinuteFactWithinBudget(env, input, writer) {
  // The fast inline live path bypasses the derive/enrichment entrypoints that
  // previously installed this wrapper. Apply it at the common write boundary
  // so alias timestamp checkpoints and revision caches cover every fact write.
  const activeEnv = withMinuteD1WriteThrottling(env);
  const configured = configuredTimeout(activeEnv);
  // Cloudflare D1 calls cannot be cancelled once dispatched. Queue consumers must
  // wait for the in-flight write instead of rejecting early and redelivering the
  // same message while the original D1 operation is still committing. An abort
  // that happened before the write still prevents new work from starting.
  if (minuteFactTimeoutDisabled(configured)) {
    throwIfMinuteFactAborted(activeEnv);
    return writer(activeEnv, input);
  }

  const parsed = Number(configured);
  const timeout = Number.isFinite(parsed) ? Math.max(1_000, Math.min(20_000, parsed)) : DEFAULT_TIMEOUT_MS;
  const signal = combinedAbortSignal(signalFrom(activeEnv), timeout);
  throwIfMinuteFactAborted(signal);
  return Promise.race([
    writer(boundedEnv(activeEnv, signal), input),
    rejectedWhenAborted(signal),
  ]);
}
