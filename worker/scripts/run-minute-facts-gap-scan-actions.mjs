import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runMinuteFactsGapScan } from '../src/minute-facts-gap-scan.js';
import { createWranglerRemoteD1 } from './remote-d1-adapter.mjs';

const workerRoot = resolve(import.meta.dirname, '..');
const wranglerScript = resolve(workerRoot, 'node_modules/wrangler/bin/wrangler.js');
const buddiesDatabase = process.env.BUDDIES_DATABASE_NAME || 'stationhead-buddies';
const factsDatabase = process.env.FACTS_DATABASE_NAME || 'stationhead-minute';

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

export async function runMinuteFactsGapScanActions(options = {}) {
  const env = options.env || {
    DB: withoutRetiredCommentCounts(remoteDatabase(buddiesDatabase, 'buddies')),
    BUDDIES_DB: remoteDatabase(buddiesDatabase, 'buddies-alias'),
    MINUTE_DB: remoteDatabase(factsDatabase, 'minute'),
    GAP_SCAN_WINDOW_MINUTES: process.env.GAP_SCAN_WINDOW_MINUTES || '360',
    GAP_SCAN_MAX_JOBS: process.env.GAP_SCAN_MAX_JOBS || '1',
    GAP_SCAN_RECENT_GUARD_MS: process.env.GAP_SCAN_RECENT_GUARD_MS || String(5 * 60_000),
  };
  return runMinuteFactsGapScan(env, options.dependencies || {});
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await runMinuteFactsGapScanActions()));
}
