import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { runSplitTrackHistoryCycleStep } from '../src/pages-track-history-split-cycle.js';

const workerRoot = resolve(import.meta.dirname, '..');
const wranglerScript = resolve(workerRoot, 'node_modules/wrangler/bin/wrangler.js');
const factsDatabase = process.env.FACTS_DATABASE_NAME || 'stationhead-minute';
const maxSteps = Math.max(1, Math.min(3000, Math.trunc(Number(process.env.PAGES_READ_MODEL_MAX_STEPS || 1800))));
const startedAt = Date.now();
const deadlineMs = startedAt + Math.max(60_000, Math.trunc(Number(process.env.PAGES_READ_MODEL_DEADLINE_MS || 12 * 60_000)));

function wrangler(args, options = {}) {
  return execFileSync(process.execPath, [wranglerScript, ...args], {
    cwd: workerRoot,
    env: process.env,
    encoding: 'utf8',
    stdio: options.capture === false ? 'inherit' : ['ignore', 'pipe', 'pipe'],
  });
}

function parseRows(output) {
  const text = String(output || '').trim();
  const starts = [text.indexOf('['), text.indexOf('{')].filter((index) => index >= 0);
  if (!starts.length) return [];
  const payload = JSON.parse(text.slice(Math.min(...starts)));
  const containers = Array.isArray(payload) ? payload : [payload];
  for (const container of containers) {
    const rows = container?.results || container?.result?.results || container?.result?.[0]?.results;
    if (Array.isArray(rows)) return rows;
  }
  return [];
}

function sqlValue(value) {
  if (value == null) return 'NULL';
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'bigint') return String(value);
  if (typeof value === 'boolean') return value ? '1' : '0';
  return `'${String(value).replaceAll('\u0000', '').replaceAll("'", "''")}'`;
}

function bindSql(sql, bindings) {
  let index = 0;
  const rendered = String(sql).replace(/\?/g, () => {
    if (index >= bindings.length) throw new Error('D1 adapter binding count mismatch');
    return sqlValue(bindings[index++]);
  });
  if (index !== bindings.length) throw new Error('D1 adapter received unused bindings');
  return rendered;
}

function execute(database, sql, json = true) {
  const args = ['d1', 'execute', database, '--remote', '--yes'];
  if (json) args.push('--json');
  args.push('--command', sql);
  return wrangler(args);
}

function createStatement(database, sql, bindings = []) {
  const rendered = () => bindSql(sql, bindings);
  return {
    bind(...values) { return createStatement(database, sql, values); },
    async all() { return { results: parseRows(execute(database, rendered(), true)) }; },
    async first() { return parseRows(execute(database, rendered(), true))[0] || null; },
    async run() {
      const rows = parseRows(execute(database, rendered(), true));
      return { success: true, meta: rows[0]?.meta || {}, results: rows };
    },
  };
}

function createRemoteD1(database) {
  return {
    prepare(sql) { return createStatement(database, sql); },
    async batch(statements) {
      const directory = mkdtempSync(join(workerRoot, '.pages-read-model-actions-'));
      try {
        const path = join(directory, 'batch.sql');
        const sql = statements.map((statement) => {
          if (!statement || typeof statement.__sql !== 'string') {
            throw new Error('D1 adapter batch requires prepared statements');
          }
          return `${bindSql(statement.__sql, statement.__bindings || [])};`;
        }).join('\n');
        writeFileSync(path, `${sql}\n`, 'utf8');
        wrangler(['d1', 'execute', database, '--remote', '--yes', '--file', path], { capture: false });
        return statements.map(() => ({ success: true, meta: {} }));
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    },
  };
}

function createBatchableD1(database) {
  const db = createRemoteD1(database);
  const originalPrepare = db.prepare;
  db.prepare = (sql) => {
    const statement = originalPrepare(sql);
    statement.__sql = String(sql);
    statement.__bindings = [];
    const originalBind = statement.bind;
    statement.bind = (...values) => {
      const bound = originalBind(...values);
      bound.__sql = String(sql);
      bound.__bindings = values;
      return bound;
    };
    return statement;
  };
  return db;
}

const remoteDb = createBatchableD1(factsDatabase);
const env = {
  MINUTE_DB: remoteDb,
  BUDDIES_DB: remoteDb,
  PAGES_TRACK_HISTORY_CYCLE_ENABLED: true,
};

let steps = 0;
let lastResult = null;
let timestamp = Math.floor(startedAt / 86_400_000) * 86_400_000;
while (steps < maxSteps && Date.now() < deadlineMs) {
  lastResult = await runSplitTrackHistoryCycleStep(env, timestamp, {});
  steps += 1;
  timestamp += 60_000;
  if (lastResult?.reason === 'track-history-cycle-already-published') break;
  if (lastResult?.stage?.published === true || lastResult?.publication?.phase === 'complete') break;
}

if (!lastResult || (steps >= maxSteps && lastResult?.stage?.published !== true)) {
  throw new Error(`Pages read-model rebuild did not finish within ${steps} steps`);
}

console.log(JSON.stringify({
  ok: true,
  event: 'pages_read_model_actions_complete',
  steps,
  elapsed_ms: Date.now() - startedAt,
  result: lastResult,
}));
