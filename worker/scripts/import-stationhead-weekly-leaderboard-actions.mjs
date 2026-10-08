import { readFileSync, appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createWranglerRemoteD1 } from './remote-d1-adapter.mjs';

import { importLeaderboardArtifact } from '../src/stationhead-leaderboard-worker.js';
export { RANKING_TYPE, SOURCE_SHEET, parseLeaderboardSnapshot, mondayDateInJst, extractLeaderboardFromArtifact, importLeaderboardArtifact } from '../src/stationhead-leaderboard-worker.js';

const DEFAULT_ARTIFACT = '../probe-artifact/stationhead-leaderboard-latest.json';

function appendSummary(result) {
  const path = process.env.GITHUB_STEP_SUMMARY;
  if (!path) return;
  appendFileSync(path, [
    '## Stationhead weekly leaderboard → Other.db',
    '',
    `- status: \`${result.status}\``,
    `- ranking_date: \`${result.ranking_date ?? ''}\``,
    `- rows: \`${result.row_count ?? 0}\``,
    `- parser: \`${result.parser ?? ''}\``,
    `- digest: \`${result.digest ? String(result.digest).slice(0, 16) : ''}\``,
    `- reason: \`${result.reason ?? ''}\``,
    '',
  ].join('\n'));
}

export async function main() {
  const artifactPath = resolve(process.cwd(), process.argv[2] || process.env.STATIONHEAD_LEADERBOARD_ARTIFACT || DEFAULT_ARTIFACT);
  const artifact = JSON.parse(readFileSync(artifactPath, 'utf8'));
  const workerRoot = resolve(import.meta.dirname, '..');
  const wranglerScript = resolve(workerRoot, 'node_modules/wrangler/bin/wrangler.js');
  const db = createWranglerRemoteD1({
    database: process.env.OTHER_DATABASE_NAME || 'stationhead-other',
    cwd: workerRoot,
    wranglerScript,
  });
  const result = await importLeaderboardArtifact(artifact, db);
  appendSummary(result);
  console.log(JSON.stringify({
    status: result.status,
    ranking_date: result.ranking_date ?? null,
    row_count: result.row_count ?? 0,
    parser: result.parser ?? null,
    digest: result.digest ? String(result.digest).slice(0, 16) : null,
    reason: result.reason ?? null,
  }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error?.stack || error);
    process.exitCode = 1;
  });
}
