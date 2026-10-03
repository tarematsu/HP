import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { loadWeeklyRankingReadModel } from '../../site/functions/lib/weekly-ranking-read-model.js';
import { pagesActionsR2ResponseKey } from '../src/pages-response-r2.js';
import { createWranglerRemoteD1 } from './remote-d1-adapter.mjs';

const workerRoot = resolve(import.meta.dirname, '..');
const wranglerScript = resolve(workerRoot, 'node_modules/wrangler/bin/wrangler.js');
const databaseName = process.env.OTHER_DATABASE_NAME || 'stationhead-other';
const responseBucket = process.env.PAGES_RESPONSE_BUCKET || 'sh-pages-responses';
const MODEL_KEY = 'leaderboard';
const CADENCE_SECONDS = 7 * 24 * 60 * 60;
const READ_MODEL_SQL = `SELECT payload_json,source_max_ranking_date,refreshed_at
FROM sh_weekly_ranking_read_model
WHERE id=1`;

function wrangler(args, { capture = true } = {}) {
  return execFileSync(process.execPath, [wranglerScript, ...args], {
    cwd: workerRoot,
    env: process.env,
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });
}

function remoteDatabase() {
  return createWranglerRemoteD1({
    database: databaseName,
    cwd: workerRoot,
    wranglerScript,
    tempPrefix: '.stationhead-leaderboard-publish-',
  });
}

function uploadJson(key, payload) {
  const directory = mkdtempSync(join(workerRoot, '.stationhead-leaderboard-r2-'));
  try {
    const path = join(directory, 'payload.json');
    writeFileSync(path, JSON.stringify(payload), 'utf8');
    wrangler([
      'r2', 'object', 'put', `${responseBucket}/${key}`,
      '--remote', '--file', path,
      '--content-type', 'application/json; charset=utf-8',
    ], { capture: false });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

export async function publishStationheadLeaderboardReadModel({
  db = remoteDatabase(),
  upload = uploadJson,
} = {}) {
  const stored = await db.prepare(READ_MODEL_SQL).first();
  if (!stored?.payload_json) throw new Error('weekly leaderboard read model is missing');

  const model = await loadWeeklyRankingReadModel(db, stored);
  if (!model) throw new Error('weekly leaderboard read model could not be loaded');

  const updatedAt = Number(stored.refreshed_at) || Number(model.refreshed_at) || Date.now();
  const body = JSON.stringify(model);
  const key = pagesActionsR2ResponseKey(MODEL_KEY);
  upload(key, {
    version: 1,
    updated_at: updatedAt,
    cadence_seconds: CADENCE_SECONDS,
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=300, s-maxage=900, stale-while-revalidate=3600',
    },
    body,
  });

  return {
    ok: true,
    model_key: MODEL_KEY,
    object_key: key,
    updated_at: updatedAt,
    source_max_ranking_date: stored.source_max_ranking_date || model.source_max_ranking_date || null,
    bytes: body.length,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  publishStationheadLeaderboardReadModel()
    .then((result) => console.log(JSON.stringify(result)))
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
