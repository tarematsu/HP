import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

import { createWranglerRemoteD1 } from '../../worker/scripts/remote-d1-adapter.mjs';

const HANDLES = Object.freeze([
  'sakuramankai',
  'sakuramankai2',
  'sakurazaka46jp',
  'nogizaka46smej',
]);
const PROFILE_API = 'https://www.stationhead.com/api/account/handle/';
const RESPONSE_BUCKET = 'sh-pages-responses';
const RESPONSE_KEY = 'pages-response/v1/followers.json';
const DATABASE_NAME = 'stationhead-other';
const JST_OFFSET_MS = 9 * 60 * 60_000;
const DAY_MS = 86_400_000;
const repoRoot = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const workerRoot = join(repoRoot, 'worker');
const wranglerScript = join(workerRoot, 'node_modules/wrangler/bin/wrangler.js');

function jstDateKey(timestamp) {
  return new Date(Number(timestamp) + JST_OFFSET_MS).toISOString().slice(0, 10);
}

function offsetDateKey(date, days) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

function nonNegativeInteger(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function findAccount(value, handle, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 12) return null;
  if (!Array.isArray(value)) {
    const followers = nonNegativeInteger(value.followers);
    if (followers != null && String(value.handle || '').trim().toLowerCase() === handle) return value;
  }
  for (const child of Object.values(value)) {
    const account = findAccount(child, handle, depth + 1);
    if (account) return account;
  }
  return null;
}

async function fetchFollowerSnapshot() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo',
  });
  const observedAt = Date.now();
  const followers = {};
  const accountIds = {};
  try {
    const page = await context.newPage();
    for (const handle of HANDLES) {
      // Establish the same anonymous browser session that the public profile UI uses.
      await page.goto(`https://www.stationhead.com/${handle}`, {
        waitUntil: 'domcontentloaded',
        timeout: 45_000,
      });
      await page.waitForTimeout(1_000);

      const response = await context.request.get(`${PROFILE_API}${encodeURIComponent(handle)}`, {
        timeout: 30_000,
        failOnStatusCode: false,
      });
      if (response.status() !== 200) {
        throw new Error(`${handle} profile API returned ${response.status()}`);
      }
      const account = findAccount(await response.json(), handle);
      if (!account) throw new Error(`${handle} follower count missing`);
      followers[handle] = Number(account.followers);
      accountIds[handle] = Number(account.id ?? account.account_id) || null;
    }
  } finally {
    await browser.close();
  }
  return { observedAt, followers, accountIds };
}

function normalizeRows(rows) {
  const byDate = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const date = String(row?.date || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const normalized = { date };
    let valid = true;
    for (const handle of HANDLES) {
      const value = nonNegativeInteger(row?.[handle]);
      if (value == null) {
        valid = false;
        break;
      }
      normalized[handle] = value;
    }
    if (valid) byDate.set(date, normalized);
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function followerSummary(rows) {
  const latest = rows.at(-1);
  if (!latest) return [];
  const byDate = new Map(rows.map((row) => [row.date, row]));
  const previous = byDate.get(offsetDateKey(latest.date, -1));
  const previousWeek = byDate.get(offsetDateKey(latest.date, -7));
  return HANDLES.map((handle) => ({
    handle,
    followers: latest[handle],
    previous_day_delta: previous ? latest[handle] - previous[handle] : null,
    previous_week_delta: previousWeek ? latest[handle] - previousWeek[handle] : null,
  }));
}

function wrangler(args, options = {}) {
  return execFileSync(process.execPath, [wranglerScript, ...args], {
    cwd: workerRoot,
    env: process.env,
    encoding: 'utf8',
    stdio: options.capture === false ? 'inherit' : ['ignore', 'pipe', 'pipe'],
  });
}

function loadR2Model() {
  const dir = mkdtempSync(join(tmpdir(), 'followers-r2-read-'));
  const file = join(dir, 'followers.json');
  try {
    try {
      wrangler(['r2', 'object', 'get', `${RESPONSE_BUCKET}/${RESPONSE_KEY}`, '--remote', '--file', file]);
    } catch (error) {
      const detail = `${String(error?.stderr || '')}\n${String(error?.stdout || '')}\n${String(error?.message || '')}`;
      if (/not found|does not exist|NoSuchKey|404/i.test(detail)) return null;
      throw error;
    }
    return JSON.parse(readFileSync(file, 'utf8'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function saveR2Model(payload, updatedAt) {
  const dir = mkdtempSync(join(tmpdir(), 'followers-r2-write-'));
  const file = join(dir, 'followers.json');
  try {
    writeFileSync(file, JSON.stringify(payload), 'utf8');
    wrangler([
      'r2', 'object', 'put', `${RESPONSE_BUCKET}/${RESPONSE_KEY}`,
      '--remote', '--file', file,
      '--content-type', 'application/json; charset=utf-8',
      '--custom-metadata', `version=1,status=200,updated_at=${updatedAt},cadence_seconds=86400,headers_json=${JSON.stringify({
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'public, max-age=30, s-maxage=300, stale-while-revalidate=600',
      })}`,
    ], { capture: false });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function main() {
  const snapshot = await fetchFollowerSnapshot();
  const date = jstDateKey(snapshot.observedAt);
  const collectedAt = Date.now();

  const existing = loadR2Model();
  const rows = normalizeRows([
    ...(existing?.rows || []),
    { date, ...snapshot.followers },
  ]);

  const db = createWranglerRemoteD1({
    database: DATABASE_NAME,
    cwd: workerRoot,
    wranglerScript,
  });
  const writeResult = await db.prepare(`INSERT INTO sh_stationhead_daily_followers (
      observed_date_jst,scheduled_at,collected_at,
      sakuramankai,sakuramankai2,sakurazaka46jp,nogizaka46smej
    ) VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(observed_date_jst) DO UPDATE SET
      scheduled_at=excluded.scheduled_at,
      collected_at=excluded.collected_at,
      sakuramankai=excluded.sakuramankai,
      sakuramankai2=excluded.sakuramankai2,
      sakurazaka46jp=excluded.sakurazaka46jp,
      nogizaka46smej=excluded.nogizaka46smej`)
    .bind(
      date,
      snapshot.observedAt,
      collectedAt,
      snapshot.followers.sakuramankai,
      snapshot.followers.sakuramankai2,
      snapshot.followers.sakurazaka46jp,
      snapshot.followers.nogizaka46smej,
    )
    .run();

  const payload = {
    ok: true,
    updated_at: collectedAt,
    latest_date: rows.at(-1)?.date || null,
    handles: HANDLES,
    rows,
    accounts: followerSummary(rows),
  };
  saveR2Model(payload, collectedAt);

  console.log(JSON.stringify({
    event: 'stationhead_daily_followers_collected',
    observed_date_jst: date,
    followers: snapshot.followers,
    account_ids: snapshot.accountIds,
    d1_rows_written: Number(writeResult?.meta?.changes || 0),
    d1_reads: 0,
    r2_reads: 1,
    r2_writes: 1,
    history_rows: rows.length,
  }));
}

await main();
