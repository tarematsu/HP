const DAY = 86_400_000;
const HOUR = 3_600_000;
const GROUPS = ['sakurazaka46', 'nogizaka46', 'hinatazaka46'];
const SPOTIFY_DAILY_DELTA_OUTLIER_THRESHOLD = 5_000_000;
const dayKey = (at) => new Date(at).toISOString().slice(0, 10);
const jstDayKey = (at) => new Date(at + 9 * HOUR).toISOString().slice(0, 10);

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

// The weekly leaderboard is published on Monday night (21:17 JST).
// Allow three hours for collection and publication before calling the source stale.
export function leaderboardSourceIssues(payload, now = Date.now()) {
  if (payload?.setup_required) return ['leaderboard read model is unavailable'];
  const latest = String(payload?.source_max_ranking_date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(latest)) return ['leaderboard source week is missing'];
  const jst = new Date(now + 9 * HOUR);
  jst.setUTCHours(0, 0, 0, 0);
  jst.setUTCDate(jst.getUTCDate() - ((jst.getUTCDay() + 6) % 7));
  const expected = jst.toISOString().slice(0, 10);
  const deadline = Date.parse(`${expected}T12:17:00Z`) + 3 * HOUR;
  return now >= deadline && latest < expected
    ? [`leaderboard collection not confirmed for ${expected} (latest imported week: ${latest})`]
    : [];
}

// The production Spotify chart uses these same aggregate daily deltas. Keep a
// visible audit failure for completed dates whose values are large enough to
// distort the graph; the bounded repair workflow uses the same threshold.
export function spotifyDeltaOutlierIssues(payload, now = Date.now()) {
  const todayJst = jstDayKey(now);
  const issues = [];
  for (const [artistKey, points] of Object.entries(payload?.trend || {})) {
    if (!Array.isArray(points)) continue;
    for (const point of points) {
      const date = String(point?.snapshot_date || '');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date >= todayJst) continue;
      if (point?.total_delta == null || point.total_delta === '') continue;
      const delta = Number(point.total_delta);
      if (!Number.isFinite(delta)) {
        issues.push(`${artistKey}: daily total delta is not numeric on ${date}`);
      } else if (Math.abs(delta) >= SPOTIFY_DAILY_DELTA_OUTLIER_THRESHOLD) {
        issues.push(`${artistKey}: daily total delta outlier on ${date} (${delta})`);
      }
    }
  }
  return issues;
}

function safeCollectorDiagnostic(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  return text
    .replace(/https?:\\/\\/[^\\s"'<>]+/gi, '[url]')
    .replace(/((?:api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|cookie|token)\\s*[:=]\\s*)[^,\\s"'<>}]+/gi, '$1[redacted]')
    .replace(/\\bBearer\\s+\\S+/gi, 'Bearer [redacted]')
    .replace(/\\bAIza[0-9A-Za-z_-]{20,}\\b/g, '[redacted]')
    .replace(/\\b[A-Za-z0-9_-]{40,}\\b/g, '[redacted]')
    .slice(0, 400);
}

function collectorStatusIssue(state) {
  const status = String(state?.status || '').toLowerCase();
  if (!/^(error|failed|blocked|degraded)$/.test(status)) return null;
  const details = [
    state?.last_error_class ? `class=${safeCollectorDiagnostic(state.last_error_class)}` : null,
    state?.last_error_message ? `detail=${safeCollectorDiagnostic(state.last_error_message)}` : null,
  ].filter(Boolean);
  return `collector status: ${status}${details.length ? ` (${details.join('; ')})` : ''}`;
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
  tasks.push(check('stationhead:leaderboard', `/api/history?mode=ranking&from=2024-06-01&to=${dayKey(now)}&scope=featured&limit=5000`, (p) => leaderboardSourceIssues(p, now)));
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
    issues.push(...spotifyDeltaOutlierIssues(p, now));
    return issues;
  }));
  for (const [service, hours] of [['youtube-music', 36], ['kkbox', 8 * 24], ['qq-music', 8 * 24], ['kugou-music', 4 * 24]]) {
    tasks.push(check(service, `/api/${service}`, (p) => {
      const states = p.services || [];
      if (!states.length) return [timestampIssue(p.source_updated_at, now, hours * HOUR)];
      return states.flatMap((state) => [
        timestampIssue(state.last_success_at, now, hours * HOUR),
        collectorStatusIssue(state),
      ]);
    }));
  }
  await Promise.all(tasks);
  checks.sort((a, b) => a.name.localeCompare(b.name));
  return { checked_at: now, checks, failed_count: checks.filter((c) => !c.ok).length, ok: checks.every((c) => c.ok) };
}
