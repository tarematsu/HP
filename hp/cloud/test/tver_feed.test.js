import { describe, expect, it } from 'vitest';
import {
  extractTverEpisodeUrls,
  filterEpisodesBeforeNextRefresh,
  normalizeTverEpisodeUrl,
  parseTverExpiration,
  refreshTverFeed,
  shouldRefreshTverFeed,
  tverFeedResponse,
} from '../src/tver_feed.js';

describe('TVer cloud feed', () => {
  it('normalizes only tver episode URLs', () => {
    expect(normalizeTverEpisodeUrl('https://tver.jp/episodes/epABC123?utm=x#y'))
      .toBe('https://tver.jp/episodes/epABC123');
    expect(normalizeTverEpisodeUrl('/episodes/ep999')).toBe('https://tver.jp/episodes/ep999');
    expect(normalizeTverEpisodeUrl('https://example.com/episodes/ep999')).toBe('');
  });

  it('extracts escaped and relative episode URLs without duplicates', () => {
    const urls = extractTverEpisodeUrls([
      'https:\\/\\/tver.jp\\/episodes\\/epONE',
      '/episodes/epTWO?x=1',
      'https://tver.jp/episodes/epONE',
    ].join(' '));
    expect(urls).toEqual([
      'https://tver.jp/episodes/epONE',
      'https://tver.jp/episodes/epTWO',
    ]);
  });

  it('parses API endAt values and exact Japanese TVer expiry labels', () => {
    const now = new Date('2026-09-11T00:00:00.000Z');
    const epochSeconds = Date.parse('2026-09-11T02:00:00.000Z') / 1000;
    expect(parseTverExpiration(epochSeconds, now)).toBe('2026-09-11T02:00:00.000Z');
    expect(parseTverExpiration('9月11日10時30分終了予定', now))
      .toBe('2026-09-11T01:30:00.000Z');
    expect(parseTverExpiration('9月11日(金) 10:45 終了予定', now))
      .toBe('2026-09-11T01:45:00.000Z');
  });

  it('removes episodes that will expire before the next hourly collection', () => {
    const now = new Date('2026-09-11T00:00:00.000Z');
    expect(filterEpisodesBeforeNextRefresh([
      { url: 'https://tver.jp/episodes/epSOON', expiresAt: '2026-09-11T00:30:00.000Z' },
      { url: 'https://tver.jp/episodes/epEDGE', expiresAt: '2026-09-11T01:00:00.000Z' },
      { url: 'https://tver.jp/episodes/epLATER', expiresAt: '2026-09-11T01:00:01.000Z' },
      { url: 'https://tver.jp/episodes/epUNKNOWN' },
    ], now)).toEqual([
      { url: 'https://tver.jp/episodes/epLATER', expiresAt: '2026-09-11T01:00:01.000Z' },
      { url: 'https://tver.jp/episodes/epUNKNOWN' },
    ]);
  });

  it('uses TVer as authoritative source and preserves last-known-good on total failure', async () => {
    const writes = [];
    const env = {
      DATA_BUCKET: {
        put: async (...args) => writes.push(args),
      },
    };
    const feed = await refreshTverFeed(env, {
      now: new Date('2026-09-11T00:00:00.000Z'),
      collectTalent: async () => [
        'https://tver.jp/episodes/epONE',
        'https://tver.jp/episodes/epTWO',
      ],
      collectSakamichi: async () => [
        'https://tver.jp/episodes/epTWO',
        'https://tver.jp/episodes/epSTALE',
      ],
    });
    expect(feed.episodeCount).toBe(2);
    expect(feed.sources).toEqual(['tver-talent']);
    expect(feed.episodes.map((item) => item.url)).toEqual([
      'https://tver.jp/episodes/epONE',
      'https://tver.jp/episodes/epTWO',
    ]);
    expect(writes).toHaveLength(1);

    const fallback = await refreshTverFeed(env, {
      collectTalent: async () => [],
      collectSakamichi: async () => ['https://tver.jp/episodes/epBACKUP'],
    });
    expect(fallback.sources).toEqual(['sakamichidb']);
    expect(fallback.episodes).toEqual([{ url: 'https://tver.jp/episodes/epBACKUP' }]);
    expect(writes).toHaveLength(2);

    await expect(refreshTverFeed(env, {
      collectTalent: async () => [],
      collectSakamichi: async () => [],
    })).rejects.toThrow(/zero playable URLs/);
    expect(writes).toHaveLength(2);
  });

  it('filters near-expiry TVer results before writing the feed', async () => {
    const writes = [];
    const now = new Date('2026-09-11T00:00:00.000Z');
    const feed = await refreshTverFeed({
      DATA_BUCKET: { put: async (...args) => writes.push(args) },
    }, {
      now,
      collectTalent: async () => [
        { url: 'https://tver.jp/episodes/epSOON', expiresAt: '2026-09-11T00:59:59.000Z' },
        { url: 'https://tver.jp/episodes/epSAFE', expiresAt: '2026-09-11T03:00:00.000Z' },
        { url: 'https://tver.jp/episodes/epUNKNOWN' },
      ],
      collectSakamichi: async () => [],
    });
    expect(feed.episodes).toEqual([
      { url: 'https://tver.jp/episodes/epSAFE', expiresAt: '2026-09-11T03:00:00.000Z' },
      { url: 'https://tver.jp/episodes/epUNKNOWN' },
    ]);
    expect(JSON.parse(writes[0][1]).episodes).toEqual(feed.episodes);
  });

  it('refreshes every UTC hour on the hourly cron', () => {
    expect(shouldRefreshTverFeed(Date.parse('2026-09-11T00:00:00Z'))).toBe(true);
    expect(shouldRefreshTverFeed(Date.parse('2026-09-11T03:00:00Z'))).toBe(true);
    expect(shouldRefreshTverFeed(Date.parse('2026-09-11T04:00:00Z'))).toBe(true);
    expect(shouldRefreshTverFeed(Date.parse('2026-09-11T04:01:00Z'))).toBe(false);
  });

  it('serves fresh feed data and rejects stale data so native fallback can run', async () => {
    const freshAt = new Date().toISOString();
    const fresh = await tverFeedResponse({
      DATA_BUCKET: {
        get: async () => ({
          body: JSON.stringify({ generatedAt: freshAt, episodes: [{ url: 'https://tver.jp/episodes/epONE' }] }),
          customMetadata: { generatedAt: freshAt },
        }),
      },
    });
    expect(fresh.status).toBe(200);

    const staleAt = new Date(Date.now() - 13 * 60 * 60 * 1000).toISOString();
    const stale = await tverFeedResponse({
      DATA_BUCKET: {
        get: async () => ({ body: '{}', customMetadata: { generatedAt: staleAt } }),
      },
    });
    expect(stale.status).toBe(503);
  });
});
