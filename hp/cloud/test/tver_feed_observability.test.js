import { readFileSync } from 'node:fs';
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
  it('reports last success time, count, and authoritative source for a fresh feed', async () => {
    const now = new Date('2026-09-11T03:20:00.000Z');
    const result = await tverFeedObservability({
      DATA_BUCKET: bucketWith({
        generatedAt: '2026-09-11T03:00:20.000Z',
        episodeCount: 7,
        sources: ['tver-talent'],
        episodes: Array.from({ length: 7 }, (_, index) => ({ url: `https://tver.jp/episodes/ep${index}` })),
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
  });

  it('identifies SakamichiDB fallback without treating it as a collection failure', async () => {
    const now = new Date('2026-09-11T03:20:00.000Z');
    const result = await tverFeedObservability({
      DATA_BUCKET: bucketWith({
        generatedAt: '2026-09-11T03:00:00.000Z',
        episodeCount: 1,
        sources: ['https://sakamichidb.anosaka.com/tver_programs/'],
        episodes: [{ url: 'https://tver.jp/episodes/epBACKUP' }],
      }),
    }, now);

    expect(result.ok).toBe(true);
    expect(result.sources).toEqual(['sakamichidb']);
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
          { url: 'https://tver.jp/episodes/epONE' },
          { url: 'https://tver.jp/episodes/epTWO' },
        ],
      }),
    }, now);

    expect(result).toMatchObject({
      ok: false,
      status: 'stale',
      lastSuccessAt: '2026-09-11T02:00:00.000Z',
      episodeCount: 2,
      sources: ['tver-talent'],
    });
  });

  it('fails closed for missing or empty collection data', async () => {
    const now = new Date('2026-09-11T03:20:00.000Z');
    const missing = await tverFeedObservability({
      DATA_BUCKET: { get: async () => null },
    }, now);
    expect(missing).toMatchObject({ ok: false, status: 'missing' });

    const empty = await tverFeedObservability({
      DATA_BUCKET: bucketWith({
        generatedAt: '2026-09-11T03:00:00.000Z',
        episodeCount: 0,
        sources: ['tver-talent'],
        episodes: [],
      }),
    }, now);
    expect(empty).toMatchObject({ ok: false, status: 'empty' });
  });

  it('exposes collector diagnostics without coupling base deployment health to TVer freshness', () => {
    const unifiedWorker = readFileSync(
      new URL('../src/unified_worker.js', import.meta.url),
      'utf8',
    );
    expect(unifiedWorker).toMatch(/import \{ tverFeedObservability \}/);
    expect(unifiedWorker).toMatch(/TVER_FEED_HEALTH_PATH = '\/api\/health\/tver-feed'/);
    expect(unifiedWorker).toMatch(/pathname === TVER_FEED_HEALTH_PATH[\s\S]*tverFeedHealthResponse/);
    expect(unifiedWorker).toMatch(/pathname === '\/api\/health'[\s\S]*homePanelCloudHealthResponse/);
    expect(unifiedWorker).toMatch(/tverFeedObservability\(env\)/);
    expect(unifiedWorker).toMatch(/tverFeed,/);
    expect(unifiedWorker).toMatch(/status: health\.ok \? 200 : 503/);
    expect(unifiedWorker).toMatch(/status: videoResponse\.status/);
  });
});
