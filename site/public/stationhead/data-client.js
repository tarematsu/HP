// Channel API requests and per-adapter settled/in-flight cache.
import { fetchDashboard } from '../dashboard-fetch-cache.js?v=20260930.1';

export function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

export async function fetchJson(url, { signal = null, force = false } = {}) {
  const request = url.startsWith('/api/dashboard?') ? fetchDashboard : fetch;
  const response = await request(url, {
    signal,
    headers: { accept: 'application/json' },
    cache: force ? 'reload' : 'default',
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) throw new Error(payload?.error || `${url} HTTP ${response.status}`);
  return payload;
}

export function cached(loader) {
  let value = null;
  let pending = null;
  return async (options = {}) => {
    if (value && !options.force) return value;
    if (pending) return pending;
    pending = Promise.resolve(loader(options)).then((next) => {
      value = next;
      return next;
    }).finally(() => { pending = null; });
    return pending;
  };
}
