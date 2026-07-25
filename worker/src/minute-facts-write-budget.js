import { combinedAbortSignal } from './request-signal.js';

const DEFAULT_TIMEOUT_MS = 12_000;
const RAW_STATEMENT = Symbol('minute-fact-raw-statement');

function signalFrom(value) {
  if (value && typeof value.aborted === 'boolean') return value;
  return value?.__COLLECTION_ABORT_SIGNAL || null;
}

function timeoutDisabled(value) {
  if (value === false || value === 0) return true;
  return /^(0|false|off|disabled)$/i.test(String(value ?? '').trim());
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
  const configured = env?.MINUTE_FACT_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS;
  // Cloudflare D1 calls cannot be cancelled once dispatched. Queue consumers must
  // wait for the in-flight write instead of rejecting early and redelivering the
  // same message while the original D1 operation is still committing.
  if (timeoutDisabled(configured)) return writer(env, input);

  const parsed = Number(configured);
  const timeout = Number.isFinite(parsed) ? Math.max(1_000, Math.min(20_000, parsed)) : DEFAULT_TIMEOUT_MS;
  const signal = combinedAbortSignal(signalFrom(env), timeout);
  throwIfMinuteFactAborted(signal);
  return Promise.race([
    writer(boundedEnv(env, signal), input),
    rejectedWhenAborted(signal),
  ]);
}
