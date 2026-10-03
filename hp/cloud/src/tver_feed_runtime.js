const FEED_OBJECT_KEY = 'native/tver-feed.json';
const MAX_FEED_AGE_MS = 12 * 60 * 60 * 1000;

export function shouldRefreshTverFeed(scheduledTime = Date.now()) {
  const date = new Date(Number(scheduledTime) || Date.now());
  return date.getUTCMinutes() === 0;
}

export async function tverFeedResponse(env) {
  if (!env?.DATA_BUCKET) {
    return Response.json({ ok: false, error: 'TVer feed storage unavailable' }, { status: 503 });
  }
  const object = await env.DATA_BUCKET.get(FEED_OBJECT_KEY);
  if (!object) {
    return Response.json({ ok: false, error: 'TVer feed unavailable', retryable: true }, {
      status: 503,
      headers: { 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' },
    });
  }

  const generatedAtMs = Date.parse(object.customMetadata?.generatedAt || '');
  const ageMs = Date.now() - generatedAtMs;
  if (!Number.isFinite(generatedAtMs) || ageMs > MAX_FEED_AGE_MS || ageMs < -60 * 60 * 1000) {
    return Response.json({ ok: false, error: 'TVer feed stale', retryable: true }, {
      status: 503,
      headers: { 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' },
    });
  }

  return new Response(object.body, {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=300, stale-if-error=3600',
      'Access-Control-Allow-Origin': '*',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

export const TVER_FEED_OBJECT_KEY = FEED_OBJECT_KEY;
