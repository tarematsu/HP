import { importLeaderboardArtifact, STATIONHEAD_LEADERBOARD_LATEST_KEY } from './stationhead-leaderboard-worker.js';
import { materializeWeeklyRankingReadModel } from './weekly-ranking-materializer.js';
import { leaderboardPublication } from './leaderboard-publication.js';
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
  const materialized = await (dependencies.materialize || materializeWeeklyRankingReadModel)(env.OTHER_DB, now, {
    force: true, initialize: false, includeModel: true,
  });
  // Publish the model already in memory; avoid rereading its D1 pointer/chunks.
  const model = materialized?.model;
  if (!model) throw new Error('weekly leaderboard model unavailable after materialization');
  await env.PAGES_RESPONSE_R2.put(MODEL_KEY, JSON.stringify(leaderboardPublication(model, now, {
    source_digest: artifact.digest,
    source_received_at: Number(artifact.received_at || 0),
  })), { httpMetadata: { contentType: 'application/json; charset=utf-8' } });
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
