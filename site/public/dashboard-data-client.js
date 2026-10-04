// Shared read-only API client. Successful snapshots and in-flight reads are reused.
const snapshots = new Map();
export function loadDashboardJson(url, { force = false, signal = null } = {}) {
  if (signal?.aborted) return Promise.reject(signal.reason || new DOMException('Aborted', 'AbortError'));
  if (force) snapshots.delete(url);
  if (!snapshots.has(url)) {
    const request = fetch(url, { headers: { accept: 'application/json' }, cache: force ? 'reload' : 'default' })
      .then(async (response) => {
        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload?.ok) throw new Error(payload?.error || `HTTP ${response.status}`);
        return payload;
      }).catch((error) => { if (snapshots.get(url) === request) snapshots.delete(url); throw error; });
    snapshots.set(url, request);
  }
  const request = snapshots.get(url);
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
