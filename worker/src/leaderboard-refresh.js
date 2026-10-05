import { importLeaderboardArtifact, STATIONHEAD_LEADERBOARD_LATEST_KEY } from './stationhead-leaderboard-worker.js';
import { materializeWeeklyRankingReadModel } from './weekly-ranking-materializer.js';
import { loadWeeklyRankingReadModel } from '../../site/functions/lib/weekly-ranking-read-model.js';
import { pagesActionsR2ResponseKey } from './pages-response-r2.js';

const MODEL_KEY = pagesActionsR2ResponseKey('leaderboard');
export async function refreshStationheadLeaderboard(env, message = {}, now = Date.now(), dependencies = {}) {
  const key = message.history_key || STATIONHEAD_LEADERBOARD_LATEST_KEY;
  if (key !== STATIONHEAD_LEADERBOARD_LATEST_KEY && !/^diagnostics\/stationhead-leaderboard\/history\/[a-f0-9]{32}\.json$/.test(key)) throw new Error('invalid leaderboard history key');
  const object = await env.PAGES_RESPONSE_R2.get(key);
  if (!object) throw new Error('leaderboard source snapshot missing');
  const artifact = await object.json();
  if (!artifact.digest || (message.digest && message.digest !== artifact.digest)) throw new Error('leaderboard source digest mismatch');
  const publishedObject = await env.PAGES_RESPONSE_R2.get(MODEL_KEY);
  const published = publishedObject ? await publishedObject.json() : null;
  if (published?.source_digest === artifact.digest || Number(published?.source_received_at || 0) > Number(artifact.received_at || 0)) return { status: 'unchanged' };
  const imported = await (dependencies.importArtifact || importLeaderboardArtifact)(artifact, env.OTHER_DB, now);
  if (!['imported', 'unchanged'].includes(imported.status)) return imported;
  // Force regeneration even for corrections within the same ranking week, and
  // after a retry where D1 import succeeded but publication failed.
  await (dependencies.materialize || materializeWeeklyRankingReadModel)(env.OTHER_DB, now, { force: true });
  const stored = await env.OTHER_DB.prepare('SELECT payload_json,source_max_ranking_date,refreshed_at FROM sh_weekly_ranking_read_model WHERE id=1').first();
  const model = await (dependencies.loadModel || loadWeeklyRankingReadModel)(env.OTHER_DB, stored);
  if (!model) throw new Error('weekly leaderboard model unavailable after materialization');
  await env.PAGES_RESPONSE_R2.put(MODEL_KEY, JSON.stringify({
    version: 1, updated_at: now, source_digest: artifact.digest,
    source_received_at: Number(artifact.received_at || 0), cadence_seconds: 7 * 86400,
    status: 200, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=300, s-maxage=900, stale-while-revalidate=3600' },
    body: JSON.stringify(model),
  }), { httpMetadata: { contentType: 'application/json; charset=utf-8' } });
  return { status: 'published', imported: imported.status, digest: artifact.digest, updated_at: now };
}

export async function consumeLeaderboardRefresh(batch, env, refresh = refreshStationheadLeaderboard) {
  for (const message of batch.messages) {
    try {
      if (message.body?.version !== 1 || message.body?.type !== 'stationhead-leaderboard-refresh') throw new Error('invalid leaderboard refresh message');
      const result = await refresh(env, message.body);
      console.log(JSON.stringify({ event: 'stationhead-leaderboard-refresh', ...result }));
      message.ack();
    } catch (error) {
      console.error('stationhead-leaderboard-refresh-failed', { error: error.message });
      message.retry();
    }
  }
}
