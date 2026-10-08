import { importLeaderboardArtifact, STATIONHEAD_LEADERBOARD_LATEST_KEY } from './stationhead-leaderboard-worker.js';
import { materializeWeeklyRankingReadModel } from './weekly-ranking-materializer.js';
import { leaderboardPublication } from './leaderboard-publication.js';
import { headReadModelR2, publishReadModelR2 } from './read-model-r2.js';

export async function refreshStationheadLeaderboard(env, message = {}, now = Date.now(), dependencies = {}) {
  const key = message.history_key || STATIONHEAD_LEADERBOARD_LATEST_KEY;
  if (key !== STATIONHEAD_LEADERBOARD_LATEST_KEY && !/^diagnostics\/stationhead-leaderboard\/history\/[a-f0-9]{32}\.json$/.test(key)) throw new Error('invalid leaderboard history key');
  const object = await env.PAGES_RESPONSE_R2.get(key);
  if (!object) throw new Error('leaderboard source snapshot missing');
  const artifact = await object.json();
  if (!artifact.digest || (message.digest && message.digest !== artifact.digest)) throw new Error('leaderboard source digest mismatch');
  const published = await headReadModelR2(env.PAGES_RESPONSE_R2, 'leaderboard');
  const publishedDigest = published?.customMetadata?.source_digest;
  const publishedAt = Number(published?.customMetadata?.source_received_at || 0);
  if (publishedDigest === artifact.digest || publishedAt > Number(artifact.received_at || 0)) return { status: 'unchanged' };
  const imported = await (dependencies.importArtifact || importLeaderboardArtifact)(artifact, env.OTHER_DB, now);
  if (!['imported', 'unchanged'].includes(imported.status)) return imported;
  const materialized = await (dependencies.materialize || materializeWeeklyRankingReadModel)(env.OTHER_DB, now, {
    force: true, initialize: false, includeModel: true,
  });
  const model = materialized?.model;
  if (!model) throw new Error('weekly leaderboard model unavailable after materialization');
  const publication = leaderboardPublication(model, now, {
    source_digest: artifact.digest,
    source_received_at: Number(artifact.received_at || 0),
  });
  await publishReadModelR2(env.PAGES_RESPONSE_R2, 'leaderboard', publication.body, {
    status: publication.status,
    headers: publication.headers,
    updatedAt: publication.updated_at,
    cadenceSeconds: publication.cadence_seconds,
    metadata: {
      source_digest: artifact.digest,
      source_received_at: Number(artifact.received_at || 0),
    },
  });
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
