import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { GAP_SCAN_STATE_KEY, runMinuteFactsGapScan } from '../src/minute-facts-gap-scan.js';
import { createWranglerRemoteD1 } from './remote-d1-adapter.mjs';

const workerRoot = resolve(import.meta.dirname, '..');
const wranglerScript = resolve(workerRoot, 'node_modules/wrangler/bin/wrangler.js');
const buddiesDatabase = process.env.BUDDIES_DATABASE_NAME || 'stationhead-buddies';
const factsDatabase = process.env.FACTS_DATABASE_NAME || 'stationhead-minute';
const DEFAULT_GAP_SCAN_MIN_INTERVAL_MS = 4 * 60 * 60_000;

function remoteDatabase(database, suffix) {
  return createWranglerRemoteD1({
    database,
    cwd: workerRoot,
    wranglerScript,
    tempPrefix: `.minute-gap-scan-${suffix}-`,
  });
}

function withoutRetiredCommentCounts(database) {
  return {
    ...database,
    prepare(sql) {
      if (/\bsh_comment_minute_counts\b/i.test(String(sql || ''))) {
        const statement = {
          bind() { return statement; },
          async all() { return { results: [] }; },
        };
        return statement;
      }
      return database.prepare(sql);
    },
    batch(statements) {
      return database.batch(statements);
    },
  };
}

function intervalMs(value) {
  const parsed = Math.trunc(Number(value));
  if (!Number.isFinite(parsed)) return DEFAULT_GAP_SCAN_MIN_INTERVAL_MS;
  return Math.max(0, Math.min(24 * 60 * 60_000, parsed));
}

async function loadLastGapScanState(db) {
  if (!db?.prepare) return null;
  try {
    const statement = db.prepare(`SELECT last_to,updated_at
      FROM sh_minute_fact_gap_scan_state WHERE scan_key=? LIMIT 1`).bind(GAP_SCAN_STATE_KEY);
    if (typeof statement?.first !== 'function') return null;
    return await statement.first();
  } catch {
    return null;
  }
}

function recentGapScan(state, now, minimumIntervalMs) {
  const lastTo = Number(state?.last_to);
  const updatedAt = Number(state?.updated_at);
  return Number.isFinite(lastTo) && lastTo > 0
    && Number.isFinite(updatedAt) && updatedAt > 0
    && now >= updatedAt
    && now - updatedAt < minimumIntervalMs;
}

export async function runMinuteFactsGapScanActions(options = {}) {
  const env = options.env || {
    DB: withoutRetiredCommentCounts(remoteDatabase(buddiesDatabase, 'buddies')),
    BUDDIES_DB: remoteDatabase(buddiesDatabase, 'buddies-alias'),
    MINUTE_DB: remoteDatabase(factsDatabase, 'minute'),
    GAP_SCAN_WINDOW_MINUTES: process.env.GAP_SCAN_WINDOW_MINUTES || '360',
    GAP_SCAN_MAX_JOBS: process.env.GAP_SCAN_MAX_JOBS || '1',
    GAP_SCAN_RECENT_GUARD_MS: process.env.GAP_SCAN_RECENT_GUARD_MS || String(5 * 60_000),
  };
  const nowFn = options.dependencies?.now || options.now || Date.now;
  const now = Number(nowFn());
  const minimumIntervalMs = intervalMs(
    options.minimumIntervalMs ?? process.env.GAP_SCAN_MIN_INTERVAL_MS,
  );
  const loadState = options.loadState || loadLastGapScanState;
  if (options.force !== true && minimumIntervalMs > 0 && Number.isFinite(now)) {
    const state = await loadState(env.MINUTE_DB);
    if (recentGapScan(state, now, minimumIntervalMs)) {
      const summary = {
        event: 'minute_fact_gap_scan_summary',
        skipped: true,
        reason: 'gap-scan-cadence',
        last_to: Number(state.last_to),
        last_scan_at: Number(state.updated_at),
        min_interval_ms: minimumIntervalMs,
      };
      console.log(JSON.stringify(summary));
      return summary;
    }
  }
  return runMinuteFactsGapScan(env, {
    ...(options.dependencies || {}),
    now: nowFn,
  });
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await runMinuteFactsGapScanActions()));
}
