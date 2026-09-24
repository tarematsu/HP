import { loadFirstWeekComparison } from '../lib/first-week-comparison.js';

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'public, max-age=300, s-maxage=3600, stale-while-revalidate=21600',
  vary: 'accept-encoding',
};

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...JSON_HEADERS, ...headers },
  });
}

export async function onRequestGet({ env }) {
  if (!env?.MINUTE_DB?.prepare) {
    return json({ ok: false, error: 'MINUTE_DB binding missing' }, 500, {
      'cache-control': 'no-store',
    });
  }

  try {
    const payload = await loadFirstWeekComparison(env.MINUTE_DB);
    return json({
      ok: true,
      ...payload,
    });
  } catch (error) {
    console.error('first-week comparison failed', error);
    return json({ ok: false, error: error?.message || 'first-week comparison error' }, 500, {
      'cache-control': 'no-store',
    });
  }
}
