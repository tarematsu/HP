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
