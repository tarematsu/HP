import fs from 'node:fs';
import { chromium } from 'playwright';

const temp = process.env.RUNNER_TEMP;
if (!temp) throw new Error('RUNNER_TEMP is required');

const fixed = ['sakuramankai', 'sakuramankai2', 'sakurazaka46jp', 'nogizaka46smej'];
const normalizeHandle = (v) => String(v || '').trim().toLowerCase();
const parseRows = (path) => {
  try {
    const payload = JSON.parse(fs.readFileSync(path, 'utf8'));
    return Array.isArray(payload?.[0]?.results) ? payload[0].results : [];
  } catch {
    return [];
  }
};
const discovered = parseRows(`${temp}/follower-handles.json`)
  .map((row) => normalizeHandle(row?.handle))
  .filter(Boolean);
const handles = [...new Set([...fixed, ...discovered])];
const nonNegativeInteger = (v) => Number.isInteger(Number(v)) && Number(v) >= 0 ? Number(v) : null;
const validDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
const dateKey = (ts) => new Date(ts + 9 * 3600000).toISOString().slice(0, 10);
const offsetDate = (date, days) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
const sqlString = (v) => `'${String(v).replaceAll("'", "''")}'`;

function findAccount(value, handle, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 12) return null;
  if (!Array.isArray(value)) {
    const followers = nonNegativeInteger(value.followers);
    if (followers != null && normalizeHandle(value.handle) === handle) return value;
  }
  for (const child of Object.values(value)) {
    const found = findAccount(child, handle, depth + 1);
    if (found) return found;
  }
  return null;
}

const browser = await chromium.launch({ headless: true });
const profiles = [];
const failures = [];
try {
  const context = await browser.newContext({ locale: 'ja-JP', timezoneId: 'Asia/Tokyo' });
  const page = await context.newPage();
  for (const handle of handles) {
    try {
      await page.goto(`https://www.stationhead.com/${encodeURIComponent(handle)}`, {
        waitUntil: 'domcontentloaded',
        timeout: 45000,
      });
      await page.waitForTimeout(750);
      const response = await context.request.get(
        `https://www.stationhead.com/api/account/handle/${encodeURIComponent(handle)}`,
        { timeout: 30000, failOnStatusCode: false },
      );
      if (response.status() !== 200) throw new Error(`HTTP ${response.status()}`);
      const payload = await response.json();
      const account = findAccount(payload, handle);
      const followers = nonNegativeInteger(account?.followers);
      if (followers == null) throw new Error('followers missing');
      profiles.push({ handle, followers });
    } catch (error) {
      failures.push({ handle, error: String(error?.message || error).slice(0, 300) });
    }
  }
} finally {
  await browser.close();
}

const criticalFailures = failures.filter(({ handle }) => fixed.includes(handle));
if (criticalFailures.length) {
  throw new Error(`Fixed follower targets failed: ${criticalFailures.map((x) => `${x.handle}:${x.error}`).join('; ')}`);
}

const now = Date.now();
const date = dateKey(now);
const followers = Object.fromEntries(profiles.map((profile) => [profile.handle, profile.followers]));
let existing = { handles: [], rows: [] };
try {
  existing = JSON.parse(fs.readFileSync(`${temp}/followers-existing.json`, 'utf8'));
} catch {}
const allHandles = [...new Set([...(Array.isArray(existing?.handles) ? existing.handles : []), ...handles])]
  .map(normalizeHandle)
  .filter(Boolean);
const rowsByDate = new Map();
for (const row of Array.isArray(existing?.rows) ? existing.rows : []) {
  if (!validDate(row?.date)) continue;
  rowsByDate.set(row.date, { ...(rowsByDate.get(row.date) || { date: row.date }), ...row, date: row.date });
}
rowsByDate.set(date, { ...(rowsByDate.get(date) || { date }), ...followers, date });
const rows = [...rowsByDate.values()].sort((a, b) => a.date.localeCompare(b.date));
const rowMap = new Map(rows.map((row) => [row.date, row]));
const latest = rowMap.get(date) || {};
const previous = rowMap.get(offsetDate(date, -1)) || {};
const previousWeek = rowMap.get(offsetDate(date, -7)) || {};
const accounts = allHandles.map((handle) => {
  const value = nonNegativeInteger(latest?.[handle]);
  const day = nonNegativeInteger(previous?.[handle]);
  const week = nonNegativeInteger(previousWeek?.[handle]);
  return {
    handle,
    followers: value,
    previous_day_delta: value != null && day != null ? value - day : null,
    previous_week_delta: value != null && week != null ? value - week : null,
  };
});
fs.writeFileSync(`${temp}/followers-next.json`, JSON.stringify({
  ok: true,
  updated_at: now,
  latest_date: date,
  handles: allHandles,
  rows,
  accounts,
  failures,
}));

const sql = [];
for (const handle of handles) {
  const sourceMask = fixed.includes(handle) ? 1 : 2;
  sql.push(`INSERT INTO sh_stationhead_follower_targets(handle,source_mask,first_seen_at) VALUES(${sqlString(handle)},${sourceMask},${now}) ON CONFLICT(handle) DO UPDATE SET source_mask=(sh_stationhead_follower_targets.source_mask | excluded.source_mask);`);
}
sql.push(`INSERT INTO sh_stationhead_daily_followers_v2(observed_date_jst,scheduled_at,collected_at,followers_json,failures_json) VALUES(${sqlString(date)},${now},${now},${sqlString(JSON.stringify(followers))},${sqlString(JSON.stringify(failures))}) ON CONFLICT(observed_date_jst) DO UPDATE SET scheduled_at=excluded.scheduled_at,collected_at=excluded.collected_at,followers_json=excluded.followers_json,failures_json=excluded.failures_json;`);
fs.writeFileSync(`${temp}/followers-upsert.sql`, `${sql.join('\n')}\n`);
fs.writeFileSync(`${temp}/followers-meta.json`, JSON.stringify({ date, now, followers, failures }));
console.log(`FETCH_OK date=${date} successes=${profiles.length}/${handles.length} failures=${failures.length}`);
console.log(`FOLLOWERS ${JSON.stringify(followers)}`);
