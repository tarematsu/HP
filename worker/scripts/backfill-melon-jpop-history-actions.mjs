import { mkdir, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createWranglerRemoteR2 } from './remote-r2-json-adapter.mjs';
import {
  MELON_JPOP_HISTORY_START,
  MELON_JPOP_HISTORY_VIEW_KEY,
  melonCompletedMonthlyPeriods,
  melonCompletedWeeklyPeriods,
  melonJpopHistoryView,
  melonMonthlyUrlCandidates,
  melonWeeklyUrlCandidates,
  parseMelonJpopHistoryEntries,
  parseMelonMonthlyPeriod,
  parseMelonWeeklyPeriod,
} from '../src/melon-jpop-history.js';

const REQUEST_TIMEOUT_MS = 25_000;
const MAX_RETRIES = 2;
const DEFAULT_CONCURRENCY = 2;
const DEFAULT_OUTPUT = 'artifacts/melon-jpop-history.json';
const MIN_POPULATED_CHART_ROWS = 20;

function argumentValue(name, argv = process.argv.slice(2)) {
  const prefix = `--${name}=`;
  const value = argv.find((item) => String(item).startsWith(prefix));
  return value ? String(value).slice(prefix.length) : null;
}

function selectedTypes(argv = process.argv.slice(2)) {
  const value = argumentValue('types', argv);
  if (!value) return ['week', 'month'];
  const types = [...new Set(value.split(',').map((item) => item.trim()).filter(Boolean))];
  const invalid = types.filter((type) => !['week', 'month'].includes(type));
  if (invalid.length) throw new Error(`Unsupported Melon history types: ${invalid.join(', ')}`);
  return types;
}

function periodMatches(requested, parsed) {
  if (!parsed) return false;
  if (requested.type === 'week') return parsed.start === requested.start && parsed.end === requested.end;
  return parsed === requested.period;
}

function parsePeriod(type, html) {
  return type === 'week' ? parseMelonWeeklyPeriod(html) : parseMelonMonthlyPeriod(html);
}

function periodUrls(period) {
  return period.type === 'week'
    ? melonWeeklyUrlCandidates(period.start, period.end)
    : melonMonthlyUrlCandidates(period.period);
}

function compact(value) {
  return String(value || '').replaceAll('-', '');
}

function populatedChartRows(html) {
  return (String(html || '').match(/<tr\b[^>]*data-song-no=["']\d+["'][\s\S]*?<\/tr>/gi) || []).length;
}

function isModernPeriodUrl(url) {
  return /\/chart\/(?:week|month)\/index\.htm\?/i.test(String(url || ''));
}

function periodEvidence(period, html) {
  const source = String(html || '');
  const needles = period.type === 'week'
    ? [compact(period.start), compact(period.end), period.start, period.end]
    : [compact(period.period), period.period];
  for (const needle of needles) {
    const index = source.indexOf(needle);
    if (index >= 0) return source.slice(Math.max(0, index - 180), Math.min(source.length, index + needle.length + 260)).replace(/\s+/g, ' ');
  }
  const patterns = period.type === 'week'
    ? [/startDay[\s\S]{0,300}/i, /endDay[\s\S]{0,300}/i, /\d{4}[.\/-]\d{2}[.\/-]\d{2}[\s\S]{0,180}/i]
    : [/rankMonth[\s\S]{0,300}/i, /data-(?:month|period)[\s\S]{0,300}/i, /\d{4}[.\/-]\d{2}[\s\S]{0,180}/i];
  for (const pattern of patterns) {
    const match = source.match(pattern)?.[0];
    if (match) return match.replace(/\s+/g, ' ').slice(0, 480);
  }
  return `html_length=${source.length}`;
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchHtml(url, fetchImpl = fetch) {
  let lastError = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        headers: {
          accept: 'text/html,application/xhtml+xml',
          'accept-language': 'ko-KR,ko;q=0.9,en;q=0.7',
          'user-agent': 'Mozilla/5.0 compatible; skrzk-pages-melon-history/1.0',
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt < MAX_RETRIES) await sleep(500 * (attempt + 1));
    }
  }
  throw lastError || new Error('Melon request failed');
}

export async function collectMelonHistoricalPeriod(period, fetchImpl = fetch) {
  const errors = [];
  for (const url of periodUrls(period)) {
    try {
      const html = await fetchHtml(url, fetchImpl);
      const parsedPeriod = parsePeriod(period.type, html);
      const chartRows = populatedChartRows(html);
      const validatedByPage = periodMatches(period, parsedPeriod);
      const validatedByModernQuery = !parsedPeriod && isModernPeriodUrl(url) && chartRows >= MIN_POPULATED_CHART_ROWS;
      if (!validatedByPage && !validatedByModernQuery) {
        errors.push(`${url}: period mismatch (${JSON.stringify(parsedPeriod)}), chart_rows=${chartRows}; evidence=${periodEvidence(period, html)}`);
        continue;
      }
      return {
        ...period,
        status: 'ok',
        source_url: url,
        validation: validatedByPage ? 'page_period' : 'query_with_populated_chart',
        chart_rows: chartRows,
        entries: parseMelonJpopHistoryEntries(html),
      };
    } catch (error) {
      errors.push(`${url}: ${String(error?.message || error)}`);
    }
  }
  return {
    ...period,
    status: 'error',
    source_url: null,
    entries: [],
    error: errors.join(' | ').slice(0, 3000),
  };
}

async function runPool(items, worker, concurrency = DEFAULT_CONCURRENCY) {
  const results = new Array(items.length);
  let cursor = 0;
  async function consume() {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
      await sleep(120);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, items.length || 1)) }, () => consume()));
  return results;
}

export async function collectMelonJpopHistory({
  start = MELON_JPOP_HISTORY_START,
  now = Date.now(),
  types = ['week', 'month'],
  concurrency = DEFAULT_CONCURRENCY,
  fetchImpl = fetch,
  onProgress = () => {},
} = {}) {
  const periods = [
    ...(types.includes('week') ? melonCompletedWeeklyPeriods(start, now) : []),
    ...(types.includes('month') ? melonCompletedMonthlyPeriods(start, now) : []),
  ];
  let completed = 0;
  const records = await runPool(periods, async (period) => {
    const record = await collectMelonHistoricalPeriod(period, fetchImpl);
    completed += 1;
    onProgress({ completed, total: periods.length, record });
    return record;
  }, concurrency);
  return melonJpopHistoryView(records, now);
}

async function saveToR2(view) {
  const root = resolve(import.meta.dirname, '..');
  const config = JSON.parse(readFileSync(join(root, 'wrangler.regional-music.jsonc'), 'utf8'));
  const bucket = config.r2_buckets.find((row) => row.binding === 'PAGES_RESPONSE_R2')?.bucket_name;
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!account || !token) throw new Error('Cloudflare account context missing');
  if (!bucket) throw new Error('PAGES_RESPONSE_R2 bucket configuration missing');
  const wranglerScript = join(root, 'node_modules/wrangler/bin/wrangler.js');
  const r2 = createWranglerRemoteR2({ bucket, cwd: root, wranglerScript });
  await r2.put(MELON_JPOP_HISTORY_VIEW_KEY, JSON.stringify(view));
  console.log(JSON.stringify({ event: 'melon_jpop_history_saved', key: MELON_JPOP_HISTORY_VIEW_KEY }));
}

function printMatches(view) {
  const best = new Map();
  for (const item of view.history || []) {
    const key = `${item.period_type}:${item.period}:${item.canonical_artist}:${item.track_id}`;
    const previous = best.get(key);
    if (!previous || item.rank < previous.rank) best.set(key, item);
  }
  for (const item of [...best.values()].sort((a, b) => a.period.localeCompare(b.period) || a.rank - b.rank)) {
    console.log(JSON.stringify({ event: 'melon_jpop_match', ...item }));
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const start = argumentValue('start', argv) || MELON_JPOP_HISTORY_START;
  const output = argumentValue('output', argv) || DEFAULT_OUTPUT;
  const concurrency = Math.max(1, Math.min(4, Number(argumentValue('concurrency', argv)) || DEFAULT_CONCURRENCY));
  const types = selectedTypes(argv);
  const view = await collectMelonJpopHistory({
    start,
    types,
    concurrency,
    onProgress({ completed, total, record }) {
      const entries = record.entries?.length || 0;
      if (entries || record.status !== 'ok' || completed % 25 === 0 || completed === total) {
        console.log(JSON.stringify({
          event: 'melon_jpop_progress',
          completed,
          total,
          type: record.type,
          period: record.period,
          status: record.status,
          entries,
        }));
      }
    },
  });
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(view, null, 2)}\n`, 'utf8');
  printMatches(view);
  console.log(JSON.stringify({ event: 'melon_jpop_history_complete', output, coverage: view.coverage }));
  if (argv.includes('--persist')) await saveToR2(view);
  if (!view.coverage?.checked_periods) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || String(error));
    process.exitCode = 1;
  });
}
