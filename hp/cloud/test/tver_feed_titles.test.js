import { describe, expect, it, vi } from 'vitest';
import {
  enrichTverEpisodeTitles,
  enrichTverFeedEpisodeTitles,
  extractTverEpisodeTitle,
} from '../src/tver_feed_titles.js';

describe('TVer feed title enrichment', () => {
  it('extracts a normalized title from Open Graph metadata', () => {
    expect(extractTverEpisodeTitle(`
      <html><head>
        <meta property="og:title" content="Episode &amp; Title | TVer">
      </head></html>
    `)).toBe('Episode & Title');
  });

  it('falls back to the document title', () => {
    expect(extractTverEpisodeTitle('<title>Fallback episode｜TVer</title>'))
      .toBe('Fallback episode');
  });

  it('enriches the current variable-length list and preserves known titles', async () => {
    const fetchImpl = vi.fn(async (url) => ({
      ok: true,
      text: async () => `<meta property="og:title" content="Title for ${url.split('/').pop()} | TVer">`,
    }));
    const episodes = [
      { url: 'https://tver.jp/episodes/epONE' },
      { url: 'https://tver.jp/episodes/epTWO', title: 'Already known' },
      { url: 'https://tver.jp/episodes/epTHREE' },
    ];

    const enriched = await enrichTverEpisodeTitles(episodes, fetchImpl);

    expect(enriched).toEqual([
      { url: 'https://tver.jp/episodes/epONE', title: 'Title for epONE' },
      { url: 'https://tver.jp/episodes/epTWO', title: 'Already known' },
      { url: 'https://tver.jp/episodes/epTHREE', title: 'Title for epTHREE' },
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('writes enriched titles back to the same feed object without changing the count', async () => {
    const writes = [];
    const feed = {
      version: 1,
      generatedAt: '2026-09-11T03:00:00.000Z',
      sources: ['tver-talent'],
      episodeCount: 2,
      episodes: [
        { url: 'https://tver.jp/episodes/epONE' },
        { url: 'https://tver.jp/episodes/epTWO' },
      ],
    };
    const fetchImpl = async (url) => ({
      ok: true,
      text: async () => `<meta property="og:title" content="${url.endsWith('ONE') ? 'One' : 'Two'} | TVer">`,
    });

    const enriched = await enrichTverFeedEpisodeTitles({
      DATA_BUCKET: { put: async (...args) => writes.push(args) },
    }, feed, { fetchImpl });

    expect(enriched.episodeCount).toBe(2);
    expect(enriched.episodes.map((episode) => episode.title)).toEqual(['One', 'Two']);
    expect(writes).toHaveLength(1);
    expect(writes[0][0]).toBe('native/tver-feed.json');
    expect(JSON.parse(writes[0][1]).episodes).toEqual(enriched.episodes);
  });

  it('keeps the collected feed usable when a title lookup fails', async () => {
    const feed = {
      generatedAt: '2026-09-11T03:00:00.000Z',
      sources: ['tver-talent'],
      episodeCount: 1,
      episodes: [{ url: 'https://tver.jp/episodes/epONE' }],
    };
    const fetchImpl = async () => ({ ok: false, text: async () => '' });
    const put = vi.fn();

    const result = await enrichTverFeedEpisodeTitles({ DATA_BUCKET: { put } }, feed, { fetchImpl });

    expect(result).toEqual(feed);
    expect(put).not.toHaveBeenCalled();
  });
});
