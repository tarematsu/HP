import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  coordinatedYoutubePlaylistStartResponse,
  youtubeStartStorageCache,
} from '../src/youtube_playlist_start_coordinator.js';

const path = 'https://homepanel.internal/youtube-playlist-start';
const watch = 'https://www.youtube.com/watch?v=AbCdEfGhI12&list=PLMWqSdpIVl30';
function storage() {
  const records = new Map();
  return { get: vi.fn(async key => records.get(key)), put: vi.fn(async (key, value) => { records.set(key, value); }) };
}
afterEach(() => { vi.restoreAllMocks(); });

describe('YouTube startup HTTP CPU boundary', () => {
  it('forwards the redirect unchanged without downloading YouTube HTML in HTTP', async () => {
    const upstream = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('HTTP must not fetch YouTube'));
    const expected = new Response(null, { status: 302, headers: { Location: watch, 'Referrer-Policy': 'no-referrer', 'X-HomePanel-Youtube-Start': 'cloud-resolved' } });
    const stub = { fetch: vi.fn(async () => expected) };
    const namespace = { getByName: vi.fn(() => stub) };
    const { default: worker } = await import('../src/unified_worker.js');
    const result = await worker.fetch(new Request('https://cloud.test/v1/native/youtube-start'), { VIDEO_FEED_COORDINATOR: namespace }, {});
    expect(result).toBe(expected);
    expect(namespace.getByName).toHaveBeenCalledWith('youtube-playlist-start');
    expect(stub.fetch).toHaveBeenCalledWith(path, { redirect: 'manual' });
    expect(upstream).not.toHaveBeenCalled();
    const rejected = await worker.fetch(new Request('https://cloud.test/v1/native/youtube-start', { method: 'POST' }), { VIDEO_FEED_COORDINATOR: namespace }, {});
    expect(rejected.status).toBe(405);
    expect(stub.fetch).toHaveBeenCalledTimes(1);
  });

  it('preserves fallback playback on missing, rejected or failing coordinator without local parsing', async () => {
    const upstream = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('no HTTP fallback fetch'));
    for (const env of [{}, { VIDEO_FEED_COORDINATOR: { getByName: () => ({ fetch: async () => { throw Error('unavailable'); } }) } },
      { VIDEO_FEED_COORDINATOR: { getByName: () => ({ fetch: async () => new Response('error', { status: 503 }) }) } }]) {
      const response = await coordinatedYoutubePlaylistStartResponse(env);
      expect(response.status).toBe(302);
      expect(response.headers.get('location')).toBe('https://www.youtube.com/playlist?list=PLMWqSdpIVl30');
      expect(response.headers.get('referrer-policy')).toBe('no-referrer');
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(response.headers.get('x-homepanel-youtube-start')).toBe('native-fallback');
    }
    expect(upstream).not.toHaveBeenCalled();
  });
});

describe('YouTube DO resolver', () => {
  it('persists the direct-watch cache across eviction with expiry', async () => {
    const store = storage();
    let now = 1000;
    const cache = youtubeStartStorageCache(store, () => now);
    await cache.put(null, new Response('{"videoId":"AbCdEfGhI12"}', { headers: { 'Cache-Control': 'public, max-age=21600' } }));
    expect(await (await youtubeStartStorageCache(store, () => now).match()).json()).toEqual({ videoId: 'AbCdEfGhI12' });
    now += 21600000;
    expect(await cache.match()).toBeUndefined();
  });

  it('coalesces concurrent cold requests, then serves the direct-watch cache', async () => {
    vi.resetModules();
    const { VideoFeedCoordinator } = await import('../src/tver_feed_refresh_coordinator.js');
    const store = storage();
    let release;
    const ready = new Promise(resolve => { release = resolve; });
    const upstream = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      await ready;
      return new Response('x'.repeat(2 * 1024 * 1024) + '"playlistVideoRenderer":{"videoId":"AbCdEfGhI12"}');
    });
    const coordinator = new VideoFeedCoordinator({ storage: store }, {});
    const pending = [coordinator.fetch(new Request(path)), coordinator.fetch(new Request(path))];
    release();
    for (const response of await Promise.all(pending)) {
      expect(response.status).toBe(302);
      expect(response.headers.get('location')).toBe(watch);
      expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    }
    expect(upstream).toHaveBeenCalledTimes(1);
    expect(store.put).toHaveBeenCalledTimes(1);
    const cached = await coordinator.fetch(new Request(path));
    expect(cached.headers.get('x-homepanel-youtube-start')).toBe('cloud-cache');
    expect(upstream).toHaveBeenCalledTimes(1);
    vi.resetModules();
    const { VideoFeedCoordinator: RestartedCoordinator } = await import('../src/tver_feed_refresh_coordinator.js');
    const restarted = await new RestartedCoordinator({ storage: store }, {}).fetch(new Request(path));
    expect(restarted.headers.get('location')).toBe(watch);
    expect(restarted.headers.get('x-homepanel-youtube-start')).toBe('cloud-cache');
    expect(upstream).toHaveBeenCalledTimes(1);
    const invalid = await coordinator.fetch(new Request(path, { method: 'POST' }));
    expect(invalid.status).toBe(405);
  });
});
