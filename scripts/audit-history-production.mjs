import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const DAY_MS = 86_400_000;
const MODES = ['daily', 'weekly', 'monthly', 'broadcasts'];
const integer = new Intl.NumberFormat('ja-JP');
const decimal = new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 1 });

function parseArgs(argv) {
  const options = { baseUrl: 'https://skrzk.pages.dev', out: '.history-production-audit' };
  for (const arg of argv) {
    if (arg.startsWith('--url=')) options.baseUrl = arg.slice(6).replace(/\/$/, '');
    else if (arg.startsWith('--out=')) options.out = arg.slice(6);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function finite(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function numberText(value) {
  return finite(value) == null ? '—' : decimal.format(Number(value));
}

function average(rows, key) {
  const values = rows.map((row) => finite(row?.[key])).filter((value) => value != null);
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function isoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

function validPeriodKey(mode, value) {
  if (mode === 'monthly') return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(value || ''));
  return isoDate(value);
}

function shiftDate(value, days) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function monthEnd(monthKey) {
  const [year, month] = monthKey.split('-').map(Number);
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function approx(a, b, tolerance = 0.15) {
  const av = finite(a);
  const bv = finite(b);
  return av == null && bv == null || av != null && bv != null && Math.abs(av - bv) <= tolerance;
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { accept: 'application/json', 'cache-control': 'no-cache' },
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = null; }
  return {
    url,
    status: response.status,
    headers: Object.fromEntries(response.headers.entries()),
    text,
    data,
  };
}

function expectedUi(rows) {
  return {
    periods: numberText(rows.length),
    maxListener: numberText(average(rows, 'listener_avg')),
    streamGrowth: numberText(average(rows, 'stream_growth')),
    memberGrowth: numberText(average(rows, 'member_growth')),
  };
}

function validateRows(mode, payload, errors, warnings) {
  const rows = Array.isArray(payload?.rows) ? payload.rows : [];
  const seen = new Set();
  let previous = '';
  for (const [index, row] of rows.entries()) {
    const key = String(row?.period_key || row?.event_name || '');
    if (mode !== 'broadcasts') {
      if (!validPeriodKey(mode, key)) errors.push(`${mode}[${index}] invalid period_key: ${key}`);
      if (previous && key < previous) errors.push(`${mode} rows are not ascending at ${previous} -> ${key}`);
      if (seen.has(key)) errors.push(`${mode} duplicate period_key: ${key}`);
      seen.add(key);
      previous = key;
    }

    const sampleCount = finite(row?.sample_count);
    const reliableCount = finite(row?.reliable_sample_count);
    if (sampleCount != null && (!Number.isInteger(sampleCount) || sampleCount < 0)) {
      errors.push(`${mode} ${key} invalid sample_count=${row.sample_count}`);
    }
    if (reliableCount != null && (!Number.isInteger(reliableCount) || reliableCount < 0)) {
      errors.push(`${mode} ${key} invalid reliable_sample_count=${row.reliable_sample_count}`);
    }
    if (sampleCount != null && reliableCount != null && reliableCount > sampleCount) {
      errors.push(`${mode} ${key} reliable_sample_count exceeds sample_count`);
    }

    const listenerMin = finite(row?.listener_min);
    const listenerAvg = finite(row?.listener_avg);
    const listenerMax = finite(row?.listener_max);
    if (listenerMin != null && listenerAvg != null && listenerMin > listenerAvg + 0.01) {
      errors.push(`${mode} ${key} listener_min > listener_avg`);
    }
    if (listenerAvg != null && listenerMax != null && listenerAvg > listenerMax + 0.01) {
      errors.push(`${mode} ${key} listener_avg > listener_max`);
    }

    const periodStart = finite(row?.period_start ?? row?.started_at);
    const periodEnd = finite(row?.period_end ?? row?.ended_at);
    if (periodStart != null && periodEnd != null && periodStart > periodEnd) {
      errors.push(`${mode} ${key} period_start > period_end`);
    }

    if (mode !== 'broadcasts') {
      const complete = row?.period_complete === true || Number(row?.period_complete) === 1;
      const streamStart = finite(row?.stream_start);
      const streamEnd = finite(row?.stream_end);
      const streamGrowth = finite(row?.stream_growth);
      const memberStart = finite(row?.member_start);
      const memberEnd = finite(row?.member_end);
      const memberGrowth = finite(row?.member_growth);
      if (complete && streamStart != null && streamEnd != null && streamEnd >= streamStart
          && !approx(streamGrowth, streamEnd - streamStart, 0.01)) {
        errors.push(`${mode} ${key} stream_growth does not equal end-start`);
      }
      if (complete && memberStart != null && memberEnd != null
          && !approx(memberGrowth, memberEnd - memberStart, 0.01)) {
        errors.push(`${mode} ${key} member_growth does not equal end-start`);
      }
      if (!complete && (streamGrowth != null || memberGrowth != null)) {
        errors.push(`${mode} ${key} incomplete period retains growth values`);
      }
    }
  }

  const excluded = rows.filter((row) => row?.stream_growth_excluded === true || Number(row?.stream_growth_excluded) === 1).length;
  if (finite(payload?.excluded_stream_growth_count) != null
      && Number(payload.excluded_stream_growth_count) !== excluded) {
    warnings.push(`${mode} excluded_stream_growth_count=${payload.excluded_stream_growth_count}, row flags=${excluded}`);
  }
  return rows;
}

function aggregateDaily(rows) {
  const sampleCount = rows.reduce((sum, row) => sum + (finite(row.sample_count) || 0), 0);
  const reliableCount = rows.reduce((sum, row) => sum + (finite(row.reliable_sample_count) || 0), 0);
  const weighted = rows.reduce((sum, row) => sum + (finite(row.listener_avg) || 0) * (finite(row.reliable_sample_count) || 0), 0);
  const mins = rows.map((row) => finite(row.listener_min)).filter((value) => value != null);
  const maxes = rows.map((row) => finite(row.listener_max)).filter((value) => value != null);
  return {
    sample_count: sampleCount,
    reliable_sample_count: reliableCount,
    listener_avg: reliableCount ? weighted / reliableCount : null,
    listener_min: mins.length ? Math.min(...mins) : null,
    listener_max: maxes.length ? Math.max(...maxes) : null,
  };
}

function compareRollups(dailyRows, rollupRows, mode, mismatches) {
  const daily = new Map(dailyRows.map((row) => [row.period_key, row]));
  let compared = 0;
  for (const row of rollupRows) {
    if (!row?.period_complete) continue;
    let keys = [];
    if (mode === 'weekly') keys = Array.from({ length: 7 }, (_, index) => shiftDate(row.period_key, index));
    else {
      const count = monthEnd(row.period_key);
      keys = Array.from({ length: count }, (_, index) => `${row.period_key}-${String(index + 1).padStart(2, '0')}`);
    }
    const parts = keys.map((key) => daily.get(key)).filter(Boolean);
    if (parts.length !== keys.length || parts.some((part) => !part.period_complete)) continue;
    const expected = aggregateDaily(parts);
    compared += 1;
    for (const key of ['sample_count', 'reliable_sample_count']) {
      if (Number(row[key]) !== Number(expected[key])) {
        mismatches.push(`${mode} ${row.period_key} ${key}: actual=${row[key]} daily=${expected[key]}`);
      }
    }
    for (const key of ['listener_avg', 'listener_min', 'listener_max']) {
      if (!approx(row[key], expected[key])) {
        mismatches.push(`${mode} ${row.period_key} ${key}: actual=${row[key]} daily=${expected[key]}`);
      }
    }
  }
  return compared;
}

async function auditPage(browser, baseUrl, mode, errors) {
  const page = await browser.newPage({ locale: 'ja-JP' });
  const url = `${baseUrl}/history/#${mode}`;
  await page.goto(url, { waitUntil: 'networkidle', timeout: 45_000 });
  await page.waitForFunction(() => {
    const notice = document.getElementById('notice')?.textContent || '';
    return notice && !notice.includes('読み込み中');
  }, null, { timeout: 30_000 });
  const view = await page.evaluate(() => ({
    notice: document.getElementById('notice')?.textContent || '',
    from: document.getElementById('from')?.value || '',
    to: document.getElementById('to')?.value || '',
    periods: document.getElementById('periods')?.textContent || '',
    maxListener: document.getElementById('maxListener')?.textContent || '',
    streamGrowth: document.getElementById('streamGrowth')?.textContent || '',
    memberGrowth: document.getElementById('memberGrowth')?.textContent || '',
    tableRows: document.querySelectorAll('#tbody tr').length,
  }));
  if (view.notice.includes('取得できませんでした')) errors.push(`${mode} page error: ${view.notice}`);
  await page.close();
  return { url, ...view };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  await mkdir(options.out, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const errors = [];
  const warnings = [];
  const modeResults = {};

  try {
    for (const mode of MODES) {
      const page = await auditPage(browser, options.baseUrl, mode, errors);
      const endpoint = `${options.baseUrl}/api/history?${new URLSearchParams({ mode, from: page.from, to: page.to, v: String(Date.now()) })}`;
      const response = await fetchJson(endpoint);
      const payload = response.data;
      if (response.status !== 200 || payload?.ok !== true) {
        errors.push(`${mode} API failed: HTTP ${response.status} ${response.text.slice(0, 200)}`);
      }
      const rows = validateRows(mode, payload, errors, warnings);
      const expected = expectedUi(rows);
      for (const key of Object.keys(expected)) {
        if (page[key] !== expected[key]) errors.push(`${mode} DOM ${key}=${page[key]} API=${expected[key]}`);
      }
      if (response.headers['x-materialized-fallback']) {
        warnings.push(`${mode} used fallback=${response.headers['x-materialized-fallback']}`);
      }
      modeResults[mode] = {
        page,
        response: {
          status: response.status,
          source: response.headers['x-api-source'] || null,
          fallback: response.headers['x-materialized-fallback'] || null,
          rows: rows.length,
          first: rows.at(0)?.period_key || rows.at(0)?.event_name || null,
          last: rows.at(-1)?.period_key || rows.at(-1)?.event_name || null,
          excluded: payload?.excluded_stream_growth_count ?? null,
          liveOverlay: payload?.live_overlay_count ?? null,
          liveTruncated: payload?.live_truncated ?? null,
        },
        expected,
        payload,
      };
    }

    const early = await fetchJson(`${options.baseUrl}/api/history?mode=daily&from=2024-05-01&to=2024-06-30&v=${Date.now()}`);
    const allDaily = modeResults.daily?.payload?.rows || [];
    const earlyRows = Array.isArray(early.data?.rows) ? early.data.rows : [];
    if (earlyRows.length && allDaily.length === 800 && allDaily.at(0)?.period_key > earlyRows.at(0)?.period_key) {
      errors.push(`daily all-range is truncated: early API starts ${earlyRows.at(0).period_key}, page response starts ${allDaily.at(0).period_key}, rows=800`);
    }

    const rollupMismatches = [];
    const comparedWeekly = compareRollups(
      modeResults.daily?.payload?.rows || [],
      modeResults.weekly?.payload?.rows || [],
      'weekly',
      rollupMismatches,
    );
    const comparedMonthly = compareRollups(
      modeResults.daily?.payload?.rows || [],
      modeResults.monthly?.payload?.rows || [],
      'monthly',
      rollupMismatches,
    );
    if (rollupMismatches.length) warnings.push(...rollupMismatches.slice(0, 30));

    const broadcasts = modeResults.broadcasts?.payload?.rows || [];
    if (broadcasts.length && broadcasts.every((row) => finite(row.listener_min) == null)) {
      warnings.push('broadcasts response has no listener_min values for any row');
    }

    const report = {
      generatedAt: new Date().toISOString(),
      baseUrl: options.baseUrl,
      ok: errors.length === 0,
      errors,
      warnings,
      rollupComparison: { comparedWeekly, comparedMonthly, mismatches: rollupMismatches },
      modes: Object.fromEntries(Object.entries(modeResults).map(([mode, result]) => [mode, {
        page: result.page,
        response: result.response,
        expected: result.expected,
      }])),
      earlyDailyProbe: {
        status: early.status,
        rows: earlyRows.length,
        first: earlyRows.at(0)?.period_key || null,
        last: earlyRows.at(-1)?.period_key || null,
      },
    };
    await writeFile(`${options.out}/report.json`, `${JSON.stringify(report, null, 2)}\n`);

    console.log('# History production audit');
    console.log(`- Result: ${report.ok ? 'PASS' : 'FAIL'}`);
    console.log(`- Generated: ${report.generatedAt}`);
    for (const [mode, result] of Object.entries(report.modes)) {
      console.log(`- ${mode}: HTTP ${result.response.status}, rows=${result.response.rows}, range=${result.response.first}..${result.response.last}, source=${result.response.source || '-'}, fallback=${result.response.fallback || 'none'}`);
      console.log(`  DOM: periods=${result.page.periods}, listener=${result.page.maxListener}, stream=${result.page.streamGrowth}, member=${result.page.memberGrowth}`);
    }
    console.log(`- early daily probe: rows=${report.earlyDailyProbe.rows}, range=${report.earlyDailyProbe.first}..${report.earlyDailyProbe.last}`);
    console.log(`- rollups compared: weekly=${comparedWeekly}, monthly=${comparedMonthly}, mismatches=${rollupMismatches.length}`);
    if (errors.length) {
      console.log('## Errors');
      for (const item of errors.slice(0, 50)) console.log(`- ${item}`);
    }
    if (warnings.length) {
      console.log('## Warnings');
      for (const item of warnings.slice(0, 50)) console.log(`- ${item}`);
    }
    if (errors.length) process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
