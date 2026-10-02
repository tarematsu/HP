import { mkdir, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createWranglerRemoteR2 } from './remote-r2-json-adapter.mjs';
import { KKBOX_CHARTS, fetchKkboxChart } from '../src/regional-music-kkbox.js';
import {
  KKBOX_JAPANESE_HISTORY_START,
  KKBOX_JAPANESE_HISTORY_VIEW_KEY,
  kkboxHistoryErrorRecord,
  kkboxHistoryRecord,
  mergeKkboxJapaneseHistory,
} from '../src/kkbox-japanese-chart-history.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_DELAY_MS = 900;
const DEFAULT_OUTPUT = 'artifacts/kkbox-japanese-history.json';

function argumentValue(name, argv = process.argv.slice(2)) {
  const prefix = `--${name}=`;
  const item = argv.find((value) => String(value).startsWith(prefix));
  return item ? String(item).slice(prefix.length) : null;
}

function selected(name, allowed, fallback, argv = process.argv.slice(2)) {
  const raw = argumentValue(name, argv);
  if (!raw) return fallback;
  const values = [...new Set(raw.split(',').map((value) => value.trim()).filter(Boolean))];
  const invalid = values.filter((value) => !allowed.includes(value));
  if (invalid.length) throw new Error(`Unsupported ${name}: ${invalid.join(', ')}`);
  return values;
}

function isoDate(value) {
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(date.getTime())) throw new Error(`Invalid date: ${value}`);
  return date;
}

function dateText(date) {
  return new Date(date).toISOString().slice(0, 10);
}

export function kkboxBackfillRequestDates(start, end, period) {
  const first = isoDate(start);
  const last = isoDate(end);
  const step = period === 'daily' ? DAY_MS : 7 * DAY_MS;
  const values = [];
  for (let cursor = first.getTime(); cursor <= last.getTime(); cursor += step) values.push(dateText(cursor));
  return values;
}

function requestKey(chart, requestedDate) {
  return `${chart.territory}|${chart.period}|${chart.type}|${requestedDate}`;
}

function completedKeys(view) {
  return new Set((Array.isArray(view?.periods) ? view.periods : [])
    .filter((row) => row?.status === 'ok' && row?.requested_date)
    .map((row) => `${row.territory}|${row.period_type}|${row.chart_type}|${row.requested_date}`));
}

function chartsFor({ territories, periods, types }) {
  return KKBOX_CHARTS.filter((chart) =>
    territories.includes(chart.territory) && periods.includes(chart.period) && types.includes(chart.type));
}

async function sleep(ms) {
  if (ms > 0) await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function collectKkboxJapaneseHistory({
  existing = null,
  start = KKBOX_JAPANESE_HISTORY_START,
  end = dateText(Date.now() - 2 * DAY_MS),
  territories = ['tw', 'hk'],
  periods = ['weekly'],
  types = ['song', 'newrelease'],
  delayMs = DEFAULT_DELAY_MS,
  fetchImpl = fetch,
  onCheckpoint = async () => {},
  onProgress = () => {},
} = {}) {
  let view = existing || mergeKkboxJapaneseHistory(null, [], Date.now());
  const done = completedKeys(view);
  const requests = [];
  for (const chart of chartsFor({ territories, periods, types })) {
    for (const requestedDate of kkboxBackfillRequestDates(start, end, chart.period)) {
      if (!done.has(requestKey(chart, requestedDate))) requests.push({ chart, requestedDate });
    }
  }

  let completed = 0;
  for (const request of requests) {
    let record;
    try {
      const result = await fetchKkboxChart(request.chart, {
        date: request.requestedDate,
        fetchImpl,
        sleepImpl: sleep,
        retries: 4,
      });
      record = kkboxHistoryRecord(request.chart, result, request.requestedDate);
    } catch (error) {
      record = kkboxHistoryErrorRecord(request.chart, request.requestedDate, error);
    }
    view = mergeKkboxJapaneseHistory(view, [record], Date.now());
    completed += 1;
    onProgress({ completed, total: requests.length, record });
    if (record.status === 'ok' || completed % 25 === 0) await onCheckpoint(view, record);
    if (completed < requests.length) await sleep(delayMs);
  }
  await onCheckpoint(view, null);
  return view;
}

async function r2Context() {
  const root = resolve(import.meta.dirname, '..');
  const config = JSON.parse(readFileSync(join(root, 'wrangler.regional-music.jsonc'), 'utf8'));
  const bucket = config.r2_buckets.find((row) => row.binding === 'PAGES_RESPONSE_R2')?.bucket_name;
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!account || !token) throw new Error('Cloudflare account context missing');
  if (!bucket) throw new Error('PAGES_RESPONSE_R2 bucket configuration missing');
  const wranglerScript = join(root, 'node_modules/wrangler/bin/wrangler.js');
  return createWranglerRemoteR2({ bucket, cwd: root, wranglerScript });
}

async function main() {
  const argv = process.argv.slice(2);
  const start = argumentValue('start', argv) || KKBOX_JAPANESE_HISTORY_START;
  const end = argumentValue('end', argv) || dateText(Date.now() - 2 * DAY_MS);
  const territories = selected('territories', ['tw', 'hk'], ['tw', 'hk'], argv);
  const periods = selected('periods', ['daily', 'weekly'], ['weekly'], argv);
  const types = selected('types', ['song', 'newrelease'], ['song', 'newrelease'], argv);
  const delayMs = Math.max(250, Math.min(10_000, Number(argumentValue('delay-ms', argv)) || DEFAULT_DELAY_MS));
  const output = argumentValue('output', argv) || DEFAULT_OUTPUT;
  const persist = argv.includes('--persist');
  const r2 = persist ? await r2Context() : null;
  const existingObject = r2 ? await r2.get(KKBOX_JAPANESE_HISTORY_VIEW_KEY) : null;
  const existing = existingObject ? await existingObject.json() : null;
  let lastSavedAt = 0;

  const view = await collectKkboxJapaneseHistory({
    existing,
    start,
    end,
    territories,
    periods,
    types,
    delayMs,
    onProgress({ completed, total, record }) {
      if (record.entries?.length || record.status !== 'ok' || completed % 50 === 0 || completed === total) {
        console.log(JSON.stringify({
          event: 'kkbox_history_progress',
          completed,
          total,
          territory: record.territory,
          period_type: record.period_type,
          chart_type: record.chart_type,
          requested_date: record.requested_date,
          period: record.period,
          status: record.status,
          entries: record.entries?.length || 0,
        }));
      }
    },
    async onCheckpoint(nextView) {
      if (!r2) return;
      const now = Date.now();
      if (now - lastSavedAt < 15_000) return;
      await r2.put(KKBOX_JAPANESE_HISTORY_VIEW_KEY, JSON.stringify(nextView));
      lastSavedAt = now;
      console.log(JSON.stringify({
        event: 'kkbox_history_checkpoint',
        checked_requests: nextView.coverage?.checked_requests,
        entries: nextView.coverage?.entries,
      }));
    },
  });

  if (r2) {
    await r2.put(KKBOX_JAPANESE_HISTORY_VIEW_KEY, JSON.stringify(view));
    console.log(JSON.stringify({ event: 'kkbox_history_saved', key: KKBOX_JAPANESE_HISTORY_VIEW_KEY }));
  }
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(view, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ event: 'kkbox_history_complete', output, coverage: view.coverage }));
  if (!view.coverage?.checked_requests && !existing?.coverage?.checked_requests) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || String(error));
    process.exitCode = 1;
  });
}
