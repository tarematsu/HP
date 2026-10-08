// Shared Stationhead API client. Generic snapshots use the dashboard-wide cache;
// only /api/dashboard keeps its delta/localStorage transport.
import { loadDashboardJson } from '../dashboard-data-client.js';
import { fetchDashboard } from '../dashboard-fetch-cache.js?v=20260930.1';

export function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

export async function fetchJson(url, { signal = null, force = false } = {}) {
  if (!url.startsWith('/api/dashboard?')) return loadDashboardJson(url, { signal, force });
  const response = await fetchDashboard(url, {
    signal,
    headers: { accept: 'application/json' },
    cache: force ? 'reload' : 'default',
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) throw new Error(payload?.error || `${url} HTTP ${response.status}`);
  return payload;
}
