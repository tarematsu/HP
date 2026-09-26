import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

import { publishRecentDailySummaries } from '../src/recent-daily-summary-publication.js';
import { createWranglerRemoteD1 } from './remote-d1-adapter.mjs';

const workerRoot = resolve(import.meta.dirname, '..');
const wranglerScript = resolve(workerRoot, 'node_modules/wrangler/bin/wrangler.js');

export async function publishRecentDailySummariesActions({
  minuteDb,
  otherDb,
  now = Date.now(),
  lookbackDays = 7,
} = {}) {
  const resolvedMinuteDb = minuteDb || createWranglerRemoteD1({
    database: process.env.FACTS_DATABASE_NAME || 'stationhead-minute',
    cwd: workerRoot,
    wranglerScript,
    tempPrefix: '.daily-summary-minute-',
  });
  const resolvedOtherDb = otherDb || createWranglerRemoteD1({
    database: process.env.OTHER_DATABASE_NAME || 'stationhead-other',
    cwd: workerRoot,
    wranglerScript,
    tempPrefix: '.daily-summary-other-',
  });
  return publishRecentDailySummaries(resolvedMinuteDb, resolvedOtherDb, now, lookbackDays);
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  const result = await publishRecentDailySummariesActions();
  console.log(JSON.stringify({ event: 'recent_daily_summary_publication', ...result }));
}
