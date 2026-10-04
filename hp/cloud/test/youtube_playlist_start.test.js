import { describe, expect, it, vi } from 'vitest';
import {
  YOUTUBE_PLAYLIST_ID,
  YOUTUBE_PLAYLIST_URL,
  firstYoutubePlaylistVideoId,
  resolveYoutubePlaylistStart,
  youtubePlaylistStartResponse,
} from '../src/youtube_playlist_start.js';

describe('YouTube playlist cloud startup', () => {
  it('extracts the first playlistVideoRenderer id in playlist order', () => {
    const html = `
      <script>
      var ytInitialData = {
        "contents": [
          {"playlistVideoRenderer":{"videoId":"AAA111bbb22","title":{"runs":[{"text":"first"}]}}},
          {"playlistVideoRenderer":{"videoId":"CCC333ddd44","title":{"runs":[{"text":"second"}]}}}
        ]
      };
      </script>`;
    expect(firstYoutubePlaylistVideoId(html)).toBe('AAA111bbb22');
  });

  it('resolves directly to watch without sending a Referer upstream', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () =>
        '<script>var ytInitialData={"playlistVideoRenderer":{"videoId":"AbCdEfGhI12"}};</script>',
    }));

    const result = await resolveYoutubePlaylistStart({
      fetchImpl,
      now: Date.parse('2026-09-13T03:00:00.000Z'),
      disableCache: true,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toBe(YOUTUBE_PLAYLIST_URL);
    const requestHeaders = fetchImpl.mock.calls[0][1]?.headers || {};
    expect(Object.keys(requestHeaders).map((key) => key.toLowerCase()))
      .not.toContain('referer');
    expect(result.videoId).toBe('AbCdEfGhI12');
    expect(result.playlistId).toBe(YOUTUBE_PLAYLIST_ID);
    expect(result.url).toBe(
      `https://www.youtube.com/watch?v=AbCdEfGhI12&list=${YOUTUBE_PLAYLIST_ID}`,
    );
  });

  it('stops streaming as soon as the first playlist item is found', async () => {
    const encoder = new TextEncoder();
    const chunks = [
      encoder.encode(
        '<script>{"playlistVideoRenderer":{"videoId":"QrStUvWxY12"}}</script>',
      ),
      encoder.encode('x'.repeat(7 * 1024 * 1024)),
    ];
    let reads = 0;
    let cancelled = false;
    const reader = {
      read: vi.fn(async () => {
        const value = chunks[reads++];
        return value ? { done: false, value } : { done: true, value: undefined };
      }),
      cancel: vi.fn(async () => { cancelled = true; }),
      releaseLock: vi.fn(),
    };
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      body: { getReader: () => reader },
      text: async () => { throw new Error('full body must not be buffered'); },
    }));

    const result = await resolveYoutubePlaylistStart({
      fetchImpl,
      now: Date.parse('2026-10-04T12:00:00.000Z'),
      disableCache: true,
    });

    expect(result.videoId).toBe('QrStUvWxY12');
    expect(reads).toBe(1);
    expect(cancelled).toBe(true);
  });

  it('returns a no-referrer redirect to the completed watch URL', async () => {
    const response = await youtubePlaylistStartResponse({
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        text: async () =>
          '<script>{"playlistVideoRenderer":{"videoId":"ZyXwVuTsR98"}}</script>',
      }),
      disableCache: true,
    });

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(
      `https://www.youtube.com/watch?v=ZyXwVuTsR98&list=${YOUTUBE_PLAYLIST_ID}`,
    );
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('x-homepanel-youtube-start')).toBe('cloud-resolved');
  });

  it('uses a persistent direct-watch cache before loading the heavy playlist fallback', async () => {
    const cached = {
      playlistId: YOUTUBE_PLAYLIST_ID,
      videoId: 'LmNoPqRsT12',
      resolvedAt: '2026-10-04T10:00:00.000Z',
    };
    const cache = {
      match: vi.fn(async () => new Response(JSON.stringify(cached))),
      put: vi.fn(),
    };
    const response = await youtubePlaylistStartResponse({
      cache,
      now: Date.parse('2099-01-01T00:00:00.000Z'),
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        text: async () => '<html>no playlist items</html>',
      }),
    });

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(
      `https://www.youtube.com/watch?v=LmNoPqRsT12&list=${YOUTUBE_PLAYLIST_ID}`,
    );
    expect(response.headers.get('x-homepanel-youtube-start')).toBe('cloud-stale-cache');
    expect(cache.match).toHaveBeenCalledTimes(1);
  });

  it('falls back to the playlist page with no referrer', async () => {
    const response = await youtubePlaylistStartResponse({
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        text: async () => '<html>no playlist items</html>',
      }),
      disableCache: true,
    });

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(YOUTUBE_PLAYLIST_URL);
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('x-homepanel-youtube-start')).toBe('native-fallback');
  });
});
