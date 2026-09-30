export const AMAZON_MUSIC_TOP_CHECK_HISTORY_KEY = 'amazon-music/rank-monitor/top-500-check-history.json';
export const AMAZON_MUSIC_TOP_CHECK_HISTORY_DAYS = 30;
export const AMAZON_MUSIC_TOP_CHECK_HISTORY_MAX = 800;

function integer(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

async function getJson(r2, key) {
  if (typeof r2?.get !== 'function') return null;
  const stored = await r2.get(key);
  if (!stored) return null;
  try {
    if (typeof stored.json === 'function') return await stored.json();
    if (typeof stored.text === 'function') return JSON.parse(await stored.text());
  } catch {
    return null;
  }
  return null;
}

async function putJson(r2, key, value) {
  await r2.put(key, JSON.stringify(value), {
    httpMetadata: { contentType: 'application/json; charset=utf-8' },
  });
}

function normalizedStatus(result) {
  if (result?.status === 'error') return 'error';
  if (result?.initialized) return 'initialized';
  return result?.updated ? 'updated' : 'unchanged';
}

export async function recordAmazonTop500Check(env, observedAt = Date.now(), result = {}) {
  const r2 = env?.PAGES_RESPONSE_R2;
  if (!r2?.put) throw new Error('PAGES_RESPONSE_R2 binding is required');

  const time = integer(observedAt) ?? Date.now();
  const previous = await getJson(r2, AMAZON_MUSIC_TOP_CHECK_HISTORY_KEY);
  const cutoff = time - AMAZON_MUSIC_TOP_CHECK_HISTORY_DAYS * 86_400_000;
  const checks = (Array.isArray(previous?.checks) ? previous.checks : [])
    .filter((item) => {
      const at = integer(item?.observed_at);
      return at != null && at >= cutoff && at !== time;
    });

  const entry = {
    observed_at: time,
    status: normalizedStatus(result),
    changed_positions: Math.max(0, integer(result?.changed_positions) ?? 0),
    scanned_tracks: Math.max(0, integer(result?.scanned_tracks) ?? 0),
    pages_scanned: Math.max(0, integer(result?.pages_scanned) ?? 0),
  };
  if (entry.status === 'error') {
    entry.error = String(result?.error || 'unknown error').slice(0, 240);
  }

  checks.push(entry);
  checks.sort((left, right) => Number(left.observed_at) - Number(right.observed_at));
  const retained = checks.slice(-AMAZON_MUSIC_TOP_CHECK_HISTORY_MAX);
  await putJson(r2, AMAZON_MUSIC_TOP_CHECK_HISTORY_KEY, {
    version: 1,
    retention_days: AMAZON_MUSIC_TOP_CHECK_HISTORY_DAYS,
    updated_at: time,
    checks: retained,
  });

  return {
    check_history_recorded: true,
    check_status: entry.status,
    check_history_entries: retained.length,
  };
}
