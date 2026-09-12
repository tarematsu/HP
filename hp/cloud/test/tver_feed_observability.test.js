import { describe, expect, it } from 'vitest';
import {
  TVER_FEED_OBSERVABILITY_MAX_AGE_MS,
  tverFeedObservability,
} from '../src/tver_feed_observability.js';

function bucketWith(feed, metadata = {}) {
  return {
    get: async () => ({
      customMetadata: metadata,
      text: async () => JSON.stringify(feed),
    }),
  };
}

describe('TVer feed observability', () => {
  it('reports the current variable-length episode list with URLs and titles', async () => {
    const now = new Date('2026-09-11T03:20:00.000Z');
    const episodes = Array.from({ length: 7 }, (_, index) => ({
      url: `https://tver.jp/episodes/ep${index}`,
      title: `Episode ${index}`,
    }));
    const result = await tverFeedObservability({
      DATA_BUCKET: bucketWith({
        generatedAt: '2026-09-11T03:00:20.000Z',
        episodeCount: episodes.length,
        sources: ['tver-talent'],
        episodes,
      }),
    }, now);

    expect(result).toMatchObject({
      ok: true,
      status: 'fresh',
      lastSuccessAt: '2026-09-11T03:00:20.000Z',
      episodeCount: 7,
      sources: ['tver-talent'],
      ageSeconds: 1180,
    });
    expect(result.episodes).toEqual(episodes);
  });

  it('keeps an episode visible when a title is temporarily unavailable', async () => {
    const now = new Date('2026-09-11T03:20:00.000Z');
    const result = await tverFeedObservability({
      DATA_BUCKET: bucketWith({
        generatedAt: '2026-09-11T03:00:00.000Z',
        episodeCount: 1,
        sources: ['tver-talent'],
        episodes: [{ url: 'https://tver.jp/episodes/epUNTITLED' }],
      }),
    }, now);

    expect(result.episodes).toEqual([{
      url: 'https://tver.jp/episodes/epUNTITLED',
      title: null,
    }]);
  });

  it('identifies SakamichiDB fallback without treating it as a collection failure', async () => {
    const now = new Date('2026-09-11T03:20:00.000Z');
    const result = await tverFeedObservability({
      DATA_BUCKET: bucketWith({
        generatedAt: '2026-09-11T03:00:00.000Z',
        episodeCount: 1,
        sources: ['https://sakamichidb.anosaka.com/tver_programs/'],
        episodes: [{ url: 'https://tver.jp/episodes/epBACKUP', title: 'Backup episode' }],
      }),
    }, now);

    expect(result.ok).toBe(true);
    expect(result.sources).toEqual(['sakamichidb']);
    expect(result.episodes).toEqual([{
      url: 'https://tver.jp/episodes/epBACKUP',
      title: 'Backup episode',
    }]);
  });

  it('marks the hourly collector stale after 90 minutes without a successful feed write', async () => {
    expect(TVER_FEED_OBSERVABILITY_MAX_AGE_MS).toBe(90 * 60 * 1000);
    const now = new Date('2026-09-11T03:31:00.000Z');
    const result = await tverFeedObservability({
      DATA_BUCKET: bucketWith({
        generatedAt: '2026-09-11T02:00:00.000Z',
        episodeCount: 2,
        sources: ['tver-talent'],
        episodes: [
          { url: 'https://tver.jp/episodes/epONE', title: 'One' },
          { url: 'https://tver.jp/episodes/epTWO', title: 'Two' },
        ],
      }),
    }, now);

    expect(result).toMatchObject({
      ok: false,
      status: 'stale',
      lastSuccessAt: '2026-09-11T02:00:00.000Z',
      episodeCount: 2,
      sources: ['tver-talent'],
      episodes: [
        { url: 'https://tver.jp/episodes/epONE', title: 'One' },
        { url: 'https://tver.jp/episodes/epTWO', title: 'Two' },
      ],
    });
  });

  it('fails closed for missing or empty collection data', async () => {
    const now = new Date('2026-09-11T03:20:00.000Z');
    const missing = await tverFeedObservability({
      DATA_BUCKET: { get: async () => null },
    }, now);
    expect(missing).toMatchObject({ ok: false, status: 'missing', episodes: [] });

    const empty = await tverFeedObservability({
      DATA_BUCKET: bucketWith({
        generatedAt: '2026-09-11T03:00:00.000Z',
        episodeCount: 0,
        sources: ['tver-talent'],
        episodes: [],
      }),
    }, now);
    expect(empty).toMatchObject({ ok: false, status: 'empty', episodes: [] });
  });
});
