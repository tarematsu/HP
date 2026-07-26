import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';

import { runRollupMaintenance } from '../src/rollup-maintenance.js';
import { pruneOldSnapshots } from '../src/snapshot-retention.js';
import { runStreamGoalPrediction } from '../src/stream-goal-prediction.js';

const workerRoot = resolve(import.meta.dirname, '..');
const wranglerScript = resolve(workerRoot, 'node_modules/wrangler/bin/wrangler.js');
const databases = {
  buddies: process.env.BUDDIES_DATABASE_NAME || 'stationhead-buddies',
  minute: process.env.FACTS_DATABASE_NAME || 'stationhead-minute',
  other: process.env.OTHER_DATABASE_NAME || 'stationhead-other',
};

function wrangler(args, capture = true) {
  return execFileSync(process.execPath, [wranglerScript, ...args], {
    cwd: workerRoot,
    env: process.env,
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });
}

function rows(output) {
  const text = String(output || '').trim();
  const starts = [text.indexOf('['), text.indexOf('{')].filter((index) => index >= 0);
  if (!starts.length) return [];
  const payload = JSON.parse(text.slice(Math.min(...starts)));
  for (const item of Array.isArray(payload) ? payload : [payload]) {
    const result = item?.results || item?.result?.results || item?.result?.[0]?.results;
    if (Array.isArray(result)) return result;
  }
  return [];
}

function value(input) {
  if (input == null) return 'NULL';
  if (typeof input === 'number' && Number.isFinite(input)) return String(input);
  if (typeof input === 'bigint') return String(input);
  if (typeof input === 'boolean') return input ? '1' : '0';
  return `'${String(input).replaceAll('\u0000', '').replaceAll("'", "''")}'`;
}

function bindSql(sql, bindings) {
  let index = 0;
  const rendered = String(sql).replace(/\?/g, () => value(bindings[index++]));
  if (index !== bindings.length) throw new Error('remote D1 binding count mismatch');
  return rendered;
}

function execute(database, sql, json = true) {
  const args = ['d1', 'execute', database, '--remote', '--yes'];
  if (json) args.push('--json');
  args.push('--command', sql);
  return wrangler(args);
}

function statement(database, sql, bindings = []) {
  return {
    __sql: sql,
    __bindings: bindings,
    bind(...next) { return statement(database, sql, next); },
    async all() { return { results: rows(execute(database, bindSql(sql, bindings))) }; },
    async first() { return rows(execute(database, bindSql(sql, bindings)))[0] || null; },
    async run() {
      const result = rows(execute(database, bindSql(sql, bindings)));
      return { success: true, meta: result[0]?.meta || {}, results: result };
    },
  };
}

function remoteD1(database) {
  return {
    prepare(sql) { return statement(database, sql); },
    async batch(statements) {
      const directory = mkdtempSync(join(workerRoot, '.runtime-maintenance-'));
      try {
        const path = join(directory, 'batch.sql');
        writeFileSync(path, `${statements.map((item) => `${bindSql(item.__sql, item.__bindings)};`).join('\n')}\n`);
        wrangler(['d1', 'execute', database, '--remote', '--yes', '--file', path], false);
        return statements.map(() => ({ success: true, meta: {} }));
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    },
  };
}

function productionEnvironment() {
  return {
    BUDDIES_DB: remoteD1(databases.buddies),
    MINUTE_DB: remoteD1(databases.minute),
    OTHER_DB: remoteD1(databases.other),
    SNAPSHOT_RETENTION_ENABLED: true,
    SNAPSHOT_RETENTION_MS: 30 * 24 * 60 * 60_000,
    SNAPSHOT_RETENTION_INTERVAL_MS: 6 * 60 * 60_000,
    SNAPSHOT_RETENTION_BATCH_SIZE: 5000,
    SNAPSHOT_RETENTION_MAX_BATCHES: 100,
    STREAM_GOAL_PREDICTION_INTERVAL_MS: 30 * 60_000,
  };
}

export async function runRuntimeOfflineMaintenanceActions(options = {}) {
  const clock = options.now || Date.now;
  const startedAt = Number(clock());
  const deadline = startedAt + Math.max(
    60_000,
    Number(process.env.RUNTIME_MAINTENANCE_DEADLINE_MS || 12 * 60_000),
  );
  const env = options.env || productionEnvironment();
  const runPrediction = options.runPrediction || runStreamGoalPrediction;
  const runRollup = options.runRollup || runRollupMaintenance;
  const runRetention = options.runRetention || pruneOldSnapshots;
  const ensureTime = () => {
    if (Number(clock()) >= deadline) {
      throw new Error('runtime offline maintenance deadline exceeded');
    }
  };

  ensureTime();
  const prediction = await runPrediction(env, startedAt);
  ensureTime();
  const rollup = await runRollup(env.BUDDIES_DB, env.OTHER_DB, null, startedAt);
  ensureTime();
  const retention = await runRetention(env, startedAt);

  return {
    ok: true,
    event: 'runtime_offline_maintenance_actions_complete',
    elapsed_ms: Math.max(0, Number(clock()) - startedAt),
    prediction,
    rollup,
    retention,
  };
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await runRuntimeOfflineMaintenanceActions()));
}
