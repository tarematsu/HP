// Shared read-only API client. Successful snapshots and in-flight reads are reused.
const snapshots = new Map();
const SNAPSHOT_MAX_AGE_MS = 60_000;
export function loadDashboardJson(url, { force = false, signal = null } = {}) {
  if (signal?.aborted) return Promise.reject(signal.reason || new DOMException('Aborted', 'AbortError'));
  if (force || Date.now() >= (snapshots.get(url)?.expiresAt ?? Infinity)) snapshots.delete(url);
  if (!snapshots.has(url)) {
    const entry = { request: null, expiresAt: Infinity };
    const request = fetch(url, { headers: { accept: 'application/json' }, cache: force ? 'reload' : 'default' })
      .then(async (response) => {
        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload?.ok) throw new Error(payload?.error || `HTTP ${response.status}`);
        entry.expiresAt = Date.now() + SNAPSHOT_MAX_AGE_MS;
        return payload;
      }).catch((error) => { if (snapshots.get(url) === entry) snapshots.delete(url); throw error; });
    entry.request = request;
    snapshots.set(url, entry);
  }
  const request = snapshots.get(url).request;
  if (!signal) return request;
  // One consumer cancelling must not abort another consumer's shared request.
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason || new DOMException('Aborted', 'AbortError'));
    signal.addEventListener('abort', abort, { once: true });
    request.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}
export function loadSpotifyReadModel(options) {
  return loadDashboardJson('/api/spotify-playcounts?artists=sakamichi', options);
}
