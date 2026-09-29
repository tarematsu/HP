import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const HANDLES = Object.freeze([
  'sakuramankai',
  'sakuramankai2',
  'sakurazaka46jp',
  'nogizaka46smej',
]);
const PROFILE_API = 'https://www.stationhead.com/api/account/handle/';
const repoRoot = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const workerRoot = join(repoRoot, 'worker');
const wranglerScript = join(workerRoot, 'node_modules/wrangler/bin/wrangler.js');
const tempDir = join(workerRoot, '.daily-followers-action');
const entryPath = join(tempDir, 'entry.js');
const configPath = join(tempDir, 'wrangler.jsonc');
const localUrl = 'http://127.0.0.1:8787';

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
  const followers = {};
  const accountIds = {};
  try {
    const page = await context.newPage();
    for (const handle of HANDLES) {
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
  return {
    observed_at: Date.now(),
    followers,
    account_ids: accountIds,
  };
}

function writeRemoteWorkerFiles() {
  mkdirSync(tempDir, { recursive: true });
  writeFileSync(entryPath, `
import { pagesR2ResponseKey, saveMaterializedR2Response } from '../src/pages-response-r2.js';

const HANDLES = ['sakuramankai', 'sakuramankai2', 'sakurazaka46jp', 'nogizaka46smej'];
const MODEL_KEY = 'followers';
const JST_OFFSET_MS = 9 * 60 * 60_000;
const DAY_MS = 86_400_000;
const HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'public, max-age=30, s-maxage=300, stale-while-revalidate=600',
};

function dateKey(timestamp) {
  return new Date(Number(timestamp) + JST_OFFSET_MS).toISOString().slice(0, 10);
}
function offsetDateKey(date, days) {
  return new Date(Date.parse(\`${'${date}'}T00:00:00Z\`) + days * DAY_MS).toISOString().slice(0, 10);
}
function nonNegativeInteger(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}
function normalizeFollowers(value) {
  const output = {};
  for (const handle of HANDLES) {
    const count = nonNegativeInteger(value?.[handle]);
    if (count == null) throw new Error(\`invalid followers for ${'${handle}'}\`);
    output[handle] = count;
  }
  return output;
}
function normalizeRows(rows) {
  const byDate = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const date = String(row?.date || '');
    if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(date)) continue;
    try {
      byDate.set(date, { date, ...normalizeFollowers(row) });
    } catch {}
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}
function summary(rows) {
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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/health') return new Response('ok');
    if (url.pathname !== '/run' || request.method !== 'POST') return new Response('not found', { status: 404 });

    const input = await request.json();
    const observedAt = Number(input?.observed_at) || Date.now();
    const followers = normalizeFollowers(input?.followers);
    const date = dateKey(observedAt);
    const collectedAt = Date.now();

    const key = pagesR2ResponseKey(MODEL_KEY);
    const object = key ? await env.PAGES_RESPONSE_R2.get(key) : null;
    let oldRows = [];
    if (object) {
      try { oldRows = normalizeRows((await object.json())?.rows); } catch {}
    }
    const rows = normalizeRows([...oldRows, { date, ...followers }]);

    const result = await env.OTHER_DB.prepare(\`INSERT INTO sh_stationhead_daily_followers (
        observed_date_jst,scheduled_at,collected_at,
        sakuramankai,sakuramankai2,sakurazaka46jp,nogizaka46smej
      ) VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(observed_date_jst) DO UPDATE SET
        scheduled_at=excluded.scheduled_at,
        collected_at=excluded.collected_at,
        sakuramankai=excluded.sakuramankai,
        sakuramankai2=excluded.sakuramankai2,
        sakurazaka46jp=excluded.sakurazaka46jp,
        nogizaka46smej=excluded.nogizaka46smej\`)
      .bind(
        date, observedAt, collectedAt,
        followers.sakuramankai, followers.sakuramankai2,
        followers.sakurazaka46jp, followers.nogizaka46smej,
      )
      .run();

    const body = JSON.stringify({
      ok: true,
      updated_at: collectedAt,
      latest_date: rows.at(-1)?.date || null,
      handles: HANDLES,
      rows,
      accounts: summary(rows),
    });
    await saveMaterializedR2Response(
      env.PAGES_RESPONSE_R2,
      MODEL_KEY,
      body,
      200,
      HEADERS,
      collectedAt,
      86400,
    );

    return Response.json({
      ok: true,
      observed_date_jst: date,
      followers,
      history_rows: rows.length,
      d1_rows_written: Number(result?.meta?.changes || 0),
      d1_reads: 0,
      r2_reads: 1,
      r2_writes: 1,
    });
  },
};
`, 'utf8');

  writeFileSync(configPath, JSON.stringify({
    name: 'sh-daily-followers-action',
    main: 'entry.js',
    compatibility_date: '2026-09-01',
    d1_databases: [{
      binding: 'OTHER_DB',
      database_name: 'stationhead-other',
      database_id: '21e70e92-6725-4e62-809e-8aadb088cc11',
    }],
    r2_buckets: [{
      binding: 'PAGES_RESPONSE_R2',
      bucket_name: 'sh-pages-responses',
    }],
  }, null, 2), 'utf8');
}

async function waitForWorker(child, output) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (child.exitCode != null) {
      throw new Error(`wrangler dev exited early: ${output().slice(-3000)}`);
    }
    try {
      const response = await fetch(`${localUrl}/health`, { signal: AbortSignal.timeout(1_500) });
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`wrangler dev did not become ready: ${output().slice(-3000)}`);
}

async function persistSnapshot(snapshot) {
  writeRemoteWorkerFiles();
  let logs = '';
  const child = spawn(process.execPath, [
    wranglerScript,
    'dev', '--remote',
    '--config', configPath,
    '--ip', '127.0.0.1',
    '--port', '8787',
    '--log-level', 'warn',
  ], {
    cwd: workerRoot,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const append = (chunk) => { logs += String(chunk); };
  child.stdout.on('data', append);
  child.stderr.on('data', append);
  try {
    await waitForWorker(child, () => logs);
    const response = await fetch(`${localUrl}/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(snapshot),
      signal: AbortSignal.timeout(45_000),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`remote persistence failed ${response.status}: ${text.slice(0, 2000)}`);
    const result = JSON.parse(text);
    if (!result?.ok || Object.keys(result.followers || {}).length !== HANDLES.length) {
      throw new Error(`remote persistence returned invalid result: ${text.slice(0, 2000)}`);
    }
    return result;
  } finally {
    child.kill('SIGTERM');
    await new Promise((resolve) => {
      if (child.exitCode != null) resolve();
      else {
        child.once('exit', resolve);
        setTimeout(resolve, 3_000).unref();
      }
    });
    rmSync(tempDir, { recursive: true, force: true });
  }
}

const snapshot = await fetchFollowerSnapshot();
const result = await persistSnapshot(snapshot);
console.log(JSON.stringify({
  event: 'stationhead_daily_followers_collected',
  ...result,
  account_ids: snapshot.account_ids,
}));
