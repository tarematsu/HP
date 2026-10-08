import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createWranglerRemoteD1 } from './remote-d1-adapter.mjs';

import { materializeWeeklyRankingReadModel } from '../src/weekly-ranking-materializer.js';
export { WEEKLY_RANKING_MODEL_VERSION, buildWeeklyRankingReadModel, splitUtf8String, materializeWeeklyRankingReadModel } from '../src/weekly-ranking-materializer.js';

function appendSummary(result) {
  if (!process.env.GITHUB_STEP_SUMMARY) return;
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, [
    '## Weekly leaderboard read model',
    '',
    `- status: \`${result.status}\``,
    `- source week: \`${result.source_max_ranking_date || ''}\``,
    `- actual rows: \`${result.row_count || 0}\``,
    `- completed rows: \`${result.completed_row_count || 0}\``,
    `- payload bytes: \`${result.payload_bytes || 0}\``,
    `- chunks: \`${result.chunk_count || 0}\``,
    '',
  ].join('\n'));
}

export async function main() {
  const workerRoot = resolve(import.meta.dirname, '..');
  const wranglerScript = resolve(workerRoot, 'node_modules/wrangler/bin/wrangler.js');
  const db = createWranglerRemoteD1({
    database: process.env.OTHER_DATABASE_NAME || 'stationhead-other',
    cwd: workerRoot,
    wranglerScript,
  });
  const result = await materializeWeeklyRankingReadModel(db);
  appendSummary(result);
  console.log(JSON.stringify(result));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error?.stack || error);
    process.exitCode = 1;
  });
}
