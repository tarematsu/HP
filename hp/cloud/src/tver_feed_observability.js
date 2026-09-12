const FEED_OBJECT_KEY = 'native/tver-feed.json';
export const TVER_FEED_OBSERVABILITY_MAX_AGE_MS = 90 * 60 * 1000;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;

function sourceNames(value) {
  if (!Array.isArray(value)) return [];
  const output = [];
  for (const raw of value) {
    const source = String(raw || '').trim();
    if (!source) continue;
    let name = source;
    if (/tver\.jp/i.test(source)) name = 'tver-talent';
    else if (/sakamichidb\.anosaka\.com/i.test(source)) name = 'sakamichidb';
    if (!output.includes(name)) output.push(name);
  }
  return output.slice(0, 8);
}

function episodeDetails(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((episode) => {
      const url = String(episode?.url || '').trim();
      if (!url) return null;
      const title = String(episode?.title || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 300);
      return { url, title: title || null };
    })
    .filter(Boolean);
}

function failure(status, checkedAt, extra = {}) {
  return {
    ok: false,
    status,
    checkedAt,
    lastSuccessAt: extra.lastSuccessAt || null,
    ageSeconds: Number.isFinite(extra.ageSeconds) ? extra.ageSeconds : null,
    episodeCount: Number.isFinite(extra.episodeCount) ? extra.episodeCount : 0,
    sources: Array.isArray(extra.sources) ? extra.sources : [],
    episodes: Array.isArray(extra.episodes) ? extra.episodes : [],
    ...(extra.error ? { error: String(extra.error).slice(0, 200) } : {}),
  };
}

export async function tverFeedObservability(env, now = new Date()) {
  const checkedAt = now.toISOString();
  if (!env?.DATA_BUCKET?.get) {
    return failure('storage-unavailable', checkedAt);
  }

  try {
    const object = await env.DATA_BUCKET.get(FEED_OBJECT_KEY);
    if (!object) return failure('missing', checkedAt);

    const metadataGeneratedAt = String(object.customMetadata?.generatedAt || '');
    let feed;
    try {
      feed = JSON.parse(await object.text());
    } catch (error) {
      return failure('invalid-json', checkedAt, {
        lastSuccessAt: metadataGeneratedAt || null,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    const lastSuccessAt = String(feed?.generatedAt || metadataGeneratedAt || '');
    const generatedAtMs = Date.parse(lastSuccessAt);
    const episodes = episodeDetails(feed?.episodes);
    const episodeCount = Number.isInteger(feed?.episodeCount)
      ? feed.episodeCount
      : episodes.length;
    const sources = sourceNames(feed?.sources);

    if (!Number.isFinite(generatedAtMs)) {
      return failure('invalid-generated-at', checkedAt, { episodeCount, sources, episodes });
    }

    const ageMs = now.getTime() - generatedAtMs;
    const ageSeconds = Math.max(0, Math.round(ageMs / 1000));
    const common = { lastSuccessAt, ageSeconds, episodeCount, sources, episodes };

    if (ageMs < -MAX_FUTURE_SKEW_MS) return failure('future-dated', checkedAt, common);
    if (episodeCount <= 0) return failure('empty', checkedAt, common);
    if (!sources.length) return failure('source-missing', checkedAt, common);
    if (ageMs > TVER_FEED_OBSERVABILITY_MAX_AGE_MS) {
      return failure('stale', checkedAt, common);
    }

    return {
      ok: true,
      status: 'fresh',
      checkedAt,
      ...common,
    };
  } catch (error) {
    return failure('read-failed', checkedAt, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
