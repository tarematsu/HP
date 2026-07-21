import { ensureDbIndexes } from './db-indexes.js';
import { finalizeCompactedFeed } from './source-feed-compacted.js';
import { recordFinalizationFailure } from './scheduled-finalization.js';
import { isCollectionTimeout, runScheduledSource } from './scheduled-source-runner.js';
import { closeStaleCollectionRuns } from './scheduled-stale-runs.js';

export async function runCollectionConfigs(env, configs, parentSignal, scope) {
  if (!configs.length) return [];

  await ensureDbIndexes(env.DB);
  await closeStaleCollectionRuns(env, configs);
  const persistence = { collectionSeenKeys: new Set() };
  const results = [];
  let successfulSources = 0;

  for (const config of configs) {
    if (parentSignal?.aborted) break;
    try {
      results.push({
        method: config.method,
        ok: true,
        result: await runScheduledSource(env, config, parentSignal, persistence)
      });
      successfulSources += 1;
    } catch (error) {
      console.error('scheduled-source-failed', {
        scope,
        method: config.method,
        timedOut: isCollectionTimeout(error),
        error: String(error?.message || error)
      });
      results.push({ method: config.method, ok: false });
      if (parentSignal?.aborted) break;
    }
  }

  if (!parentSignal?.aborted && successfulSources > 0) {
    const combinedFeedCount = await finalizeCompactedFeed(env).catch(async (error) => {
      console.error('scheduled-feed-finalization-failed', {
        scope,
        error: String(error?.message || error)
      });
      await recordFinalizationFailure(env, results, error).catch((recordError) => {
        console.error('scheduled-feed-finalization-failure-recording-failed', {
          scope,
          error: String(recordError?.message || recordError)
        });
      });
      return null;
    });
    results.push({ method: 'playback-feed-finalize', ok: combinedFeedCount !== null, combinedFeedCount });
  }
  return results;
}
