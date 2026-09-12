import { TVER_FEED_OBJECT_KEY } from './tver_feed.js';

const TITLE_FETCH_TIMEOUT_MS = 8_000;
const TITLE_FETCH_BATCH_SIZE = 8;
const MAX_TITLE_LENGTH = 300;

function decodeHtmlEntities(value) {
  return String(value || '')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function normalizeTitle(value) {
  return decodeHtmlEntities(value)
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\s*[|｜]\s*TVer(?:\s*\([^)]*\))?\s*$/i, '')
    .slice(0, MAX_TITLE_LENGTH);
}

function attributes(tag) {
  const output = {};
  const pattern = /([:\w-]+)\s*=\s*(["'])(.*?)\2/gs;
  for (const match of tag.matchAll(pattern)) {
    output[match[1].toLowerCase()] = match[3];
  }
  return output;
}

export function extractTverEpisodeTitle(html) {
  const text = String(html || '');
  for (const match of text.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = attributes(match[0]);
    const key = String(attrs.property || attrs.name || '').toLowerCase();
    if (key !== 'og:title' && key !== 'twitter:title') continue;
    const title = normalizeTitle(attrs.content);
    if (title) return title;
  }
  const titleMatch = text.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  return normalizeTitle(titleMatch?.[1]);
}

async function fetchEpisodeTitle(url, fetchImpl) {
  if (typeof fetchImpl !== 'function') return '';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TITLE_FETCH_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        accept: 'text/html,application/xhtml+xml',
        'accept-language': 'ja-JP,ja;q=0.9,en;q=0.7',
        'user-agent': 'Mozilla/5.0 (compatible; HomePanel-TVer-Metadata/1.0)',
      },
    });
    if (!response?.ok) return '';
    return extractTverEpisodeTitle(await response.text());
  } catch {
    return '';
  } finally {
    clearTimeout(timeout);
  }
}

export async function enrichTverEpisodeTitles(episodes, fetchImpl = globalThis.fetch) {
  if (!Array.isArray(episodes)) return [];
  const enriched = episodes.map((episode) => ({ ...episode }));
  const pending = enriched
    .map((episode, index) => ({ episode, index }))
    .filter(({ episode }) => episode?.url && !String(episode?.title || '').trim());

  for (let offset = 0; offset < pending.length; offset += TITLE_FETCH_BATCH_SIZE) {
    const batch = pending.slice(offset, offset + TITLE_FETCH_BATCH_SIZE);
    const titles = await Promise.all(batch.map(({ episode }) => fetchEpisodeTitle(episode.url, fetchImpl)));
    titles.forEach((title, index) => {
      if (title) enriched[batch[index].index].title = title;
    });
  }
  return enriched;
}

export async function enrichTverFeedEpisodeTitles(env, feed, dependencies = {}) {
  if (!feed || !Array.isArray(feed.episodes) || !env?.DATA_BUCKET?.put) return feed;
  const episodes = await enrichTverEpisodeTitles(feed.episodes, dependencies.fetchImpl || globalThis.fetch);
  const changed = episodes.some((episode, index) => episode.title !== feed.episodes[index]?.title);
  if (!changed) return feed;

  const enriched = { ...feed, episodes };
  try {
    await env.DATA_BUCKET.put(TVER_FEED_OBJECT_KEY, JSON.stringify(enriched), {
      httpMetadata: { contentType: 'application/json; charset=utf-8' },
      customMetadata: {
        generatedAt: String(enriched.generatedAt || ''),
        episodeCount: String(enriched.episodeCount ?? episodes.length),
      },
    });
    return enriched;
  } catch {
    return feed;
  }
}
