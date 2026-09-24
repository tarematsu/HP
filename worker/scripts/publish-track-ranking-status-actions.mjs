import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadTrackRanking } from '../../site/functions/lib/track-ranking.js';
import { uploadEnvelope } from './run-pages-read-model-actions.mjs';
import { createWranglerRemoteD1 } from './remote-d1-adapter.mjs';

const MODEL_KEY = 'track-history-status';
const workerRoot = resolve(import.meta.dirname, '..');
const wranglerScript = resolve(workerRoot, 'node_modules/wrangler/bin/wrangler.js');

function remoteMinuteDatabase() {
  return createWranglerRemoteD1({
    database: process.env.FACTS_DATABASE_NAME || 'stationhead-minute',
    cwd: workerRoot,
    wranglerScript,
    tempPrefix: '.track-ranking-status-',
  });
}

export async function publishTrackRankingStatus({
  db = remoteMinuteDatabase(),
  now = Date.now(),
  loadRanking = loadTrackRanking,
  upload = uploadEnvelope,
} = {}) {
  const ranking = await loadRanking(db, { limit: 500, persist: false });
  const summary = ranking?.summary;
  if (!Array.isArray(ranking?.rows) || !summary || typeof summary !== 'object') {
    throw new Error('Track ranking source returned an invalid result');
  }
  const body = JSON.stringify({
    ok: true,
    ranking: ranking.rows,
    ranking_summary: summary,
    ranking_scope: 'all-time-latest-counter',
    generated_at: now,
  });
  const objectKey = upload(MODEL_KEY, {
    version: 1,
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8' },
    updated_at: now,
    cadence_seconds: 1800,
    body,
  });
  return {
    ok: true,
    object_key: objectKey,
    track_count: Number(summary.track_count) || 0,
    published_at: now,
  };
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await publishTrackRankingStatus()));
}
