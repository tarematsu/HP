import {
  isCollectionTimeout,
  runWithCollectionTimeout,
  timeoutForMethod
} from './collection-guardrails.js';
import { persistCollectionCapture } from './collection-capture.js';
import {
  beginCollectionRun,
  persistMergedFeed,
  recordCollectionFailure
} from './source-feed.js';
import { sourceUrlFor } from './source-locator.js';

export function resolveCollectionSourceUrl(env, config) {
  if (config.sourceUrl) return config.sourceUrl;
  if (!config.sourceKey) return null;
  return sourceUrlFor(env, config.sourceKey);
}

export function resolveCollectionRunConfig(env, config) {
  return {
    ...config,
    sourceUrl: resolveCollectionSourceUrl(env, config)
  };
}

async function collectAndPersist(env, config, run, signal, persistence) {
  signal?.throwIfAborted?.();
  const collected = await config.collect(env, signal);
  signal?.throwIfAborted?.();
  const { urls = [], sourceUrl, elapsedMs, capture, ...details } = collected || {};
  await persistCollectionCapture(env, run, {
    method: config.method,
    sourceKey: config.sourceKey,
    sourceUrl: sourceUrl || config.sourceUrl
  }, capture).catch((error) => {
    console.error('collection-capture-persist-failed', {
      method: config.method,
      error: String(error?.message || error)
    });
  });
  return persistMergedFeed(env, {
    run,
    signal,
    collectionDurationMs: elapsedMs,
    sourceUrl: sourceUrl || config.sourceUrl,
    method: config.method,
    urls,
    deferFeedMaintenance: true,
    collectionSeenKeys: persistence.collectionSeenKeys,
    details: { ...details, elapsedMs }
  });
}

export async function runScheduledSource(env, config, parentSignal, persistence) {
  const runConfig = resolveCollectionRunConfig(env, config);
  const run = await beginCollectionRun(env, runConfig);
  try {
    const result = await runWithCollectionTimeout(
      (signal) => collectAndPersist(env, runConfig, run, signal, persistence),
      {
        timeoutMs: timeoutForMethod(runConfig.method),
        scope: runConfig.method,
        parentSignal
      }
    );
    return { ...result, runId: run.runId };
  } catch (error) {
    if (!error?.collectionRunRecorded) {
      const timings = await recordCollectionFailure(env, {
        ...runConfig,
        run,
        collectionDurationMs: Date.now() - run.collectionStartedMs
      }, error).catch((recordError) => {
        console.error('scheduled-source-failure-recording-failed', {
          method: runConfig.method,
          error: String(recordError?.message || recordError)
        });
        return null;
      });
      if (timings && error && typeof error === 'object') {
        error.collectionRunRecorded = true;
        error.timings = timings;
      }
    }
    throw error;
  }
}

export { isCollectionTimeout };
