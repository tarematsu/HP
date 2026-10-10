const DAY = 86_400_000;
const HOUR = 3_600_000;
const GROUPS = ['sakurazaka46', 'nogizaka46', 'hinatazaka46'];
const dayKey = (at) => new Date(at).toISOString().slice(0, 10);

export function timestampIssue(value, now, maxAge) {
  const at = Number(value);
  if (!Number.isFinite(at) || at <= 0) return 'source observation timestamp is missing';
  if (at > now + 5 * 60_000) return 'source observation timestamp is in the future';
  if (now - at > maxAge) return `source data is stale (${Math.floor((now - at) / HOUR)} hours old)`;
  return null;
}

export function missingRecentDays(dates, now, lookback = 7) {
  const available = [...new Set((dates || []).filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value)))].sort();
  if (!available.length) return ['date index is empty'];
  // UTC day closure gets 15 minutes to finish publication. An in-progress
  // day is never required, and dates before collection started are excluded.
  const end = Math.floor((now - 15 * 60_000) / DAY) * DAY - DAY;
  const start = Math.max(Date.parse(`${available[0]}T00:00:00Z`), end - (lookback - 1) * DAY);
  const missing = [];
  for (let at = start; at <= end; at += DAY) if (!available.includes(dayKey(at))) missing.push(dayKey(at));
  return missing;
}

export async function auditPagesData(getJson, now = Date.now()) {
  const checks = [];
  const check = async (name, path, inspect) => {
    try {
      const payload = await getJson(path);
      if (payload?.ok === false) throw new Error(payload.error || 'API returned ok=false');
      const issues = inspect(payload).filter(Boolean);
      checks.push({ name, path, issues, ok: issues.length === 0 });
    } catch (error) { checks.push({ name, path, ok: false, issues: [String(error.message || error)] }); }
  };
  const tasks = [];
  for (const [source, path] of [['buddies', '/api/dashboard?history=0'], ['ohisama', '/api/hinata']]) {
    tasks.push(check(`${source}:current`, path, (p) => [timestampIssue(p.latest?.observed_at ?? p.updated_at, now, 20 * 60_000)]));
    const historyPath = source === 'buddies'
      ? `/api/history?mode=daily&from=${dayKey(now - 8 * DAY)}&to=${dayKey(now)}` : path;
    tasks.push(check(`${source}:daily`, historyPath, (p) => missingRecentDays((p.rows || p.daily || []).map((r) => r.period_key), now).map((d) => `completed UTC day missing: ${d}`)));
    tasks.push(check(`${source}:played-dates`, `/api/track-history?source=${source}&dates_only=1`, (p) => missingRecentDays(p.dates, now).map((d) => `playback UTC day missing: ${d}`)));
  }
  tasks.push(check('amazon', '/api/amazon-music', (p) => [timestampIssue(p.observed_at, now, 36 * HOUR), p.scan?.complete !== true ? 'published Amazon scan is incomplete' : null, !p.tracks?.length ? 'Amazon track model is empty' : null]));
  tasks.push(check('apple', '/api/apple-music', (p) => {
    const artists = Array.isArray(p.artists) && p.artists.length ? p.artists : [p];
    return artists.map((a) => timestampIssue(a.observed_at, now, 36 * HOUR));
  }));
  tasks.push(check('spotify', '/api/spotify-playcounts?artists=sakamichi', (p) => {
    const issues = GROUPS.map((key) => {
      const group = p.groups?.[key];
      if (!group?.tracks?.length) return `${key}: track model is empty`;
      if (group.carried_forward) return `${key}: only carried-forward source observations are available`;
      const at = Math.min(...group.tracks.map((t) => Number(t.collected_at) || 0));
      const issue = timestampIssue(at, now, 36 * HOUR);
      return issue ? `${key}: ${issue}` : null;
    });
    issues.push(timestampIssue(p.artist_chart?.latest_observed_at, now, 48 * HOUR));
    return issues;
  }));
  for (const [service, hours] of [['youtube-music', 36], ['kkbox', 8 * 24], ['qq-music', 8 * 24], ['kugou-music', 4 * 24]]) {
    tasks.push(check(service, `/api/${service}`, (p) => [timestampIssue(p.source_updated_at, now, hours * HOUR)]));
  }
  await Promise.all(tasks);
  checks.sort((a, b) => a.name.localeCompare(b.name));
  return { checked_at: now, checks, failed_count: checks.filter((c) => !c.ok).length, ok: checks.every((c) => c.ok) };
}
