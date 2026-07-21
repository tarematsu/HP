import { persistCollectionCapture } from './collection-capture.js';
import { collectSourceAMediaUrls } from './source-a.js';
import {
  beginCollectionRun,
  persistMergedFeed,
  recordCollectionFailure
} from './source-feed.js';
import { finalizeCompactedFeed } from './source-feed-compacted.js';
import { collectSourceBMediaUrls } from './source-b.js';
import { collectSourceEMediaUrls } from './source-e.js';
import { resolveCollectionRunConfig } from './scheduled-source-runner.js';

function persistenceOptions(options) {
  return {
    deferFeedMaintenance: Boolean(options?.deferFeedMaintenance),
    collectionSeenKeys: options?.collectionSeenKeys
  };
}

function browserDetails(collected) {
  return {
    sourceMode: collected.sourceMode || null,
    finalUrl: collected.finalUrl || null,
    loadMoreClicks: collected.loadMoreClicks ?? null,
    directUrlCount: collected.directUrlCount ?? null,
    resolvedUrlCount: collected.resolvedUrlCount ?? null,
    apiUrlCount: collected.apiUrlCount ?? null,
    linkedUrlCount: collected.linkedUrlCount ?? null,
    itemCount: collected.itemCount ?? null,
    htmlBytes: collected.htmlBytes ?? null,
    resourceUrlCount: collected.resourceUrlCount ?? null,
    domSignalCount: collected.domSignalCount ?? null,
    elapsedMs: collected.elapsedMs
  };
}

async function persistCaptureForManualCollection(env, run, method, sourceKey, collected) {
  await persistCollectionCapture(env, run, {
    method,
    sourceKey,
    sourceUrl: collected.sourceUrl,
    note: 'manual-admin-collection'
  }, collected.capture).catch((error) => {
    console.error('manual-collection-capture-persist-failed', {
      method,
      error: String(error?.message || error)
    });
  });
}

async function collectSourceE(env, run, options) {
  const collected = await collectSourceEMediaUrls(env);
  await persistCaptureForManualCollection(env, run, 'source-e-browser', 'E', collected);
  return persistMergedFeed(env, {
    run,
    ...persistenceOptions(options),
    collectionDurationMs: collected.elapsedMs,
    sourceUrl: collected.sourceUrl,
    method: 'source-e-browser',
    urls: collected.urls,
    details: {
      ...browserDetails(collected),
      clicks: collected.clicks
    }
  });
}

async function collectSourceA(env, run, options) {
  const collected = await collectSourceAMediaUrls(env);
  await persistCaptureForManualCollection(env, run, 'source-a-browser', 'A', collected);
  return persistMergedFeed(env, {
    run,
    ...persistenceOptions(options),
    collectionDurationMs: collected.elapsedMs,
    sourceUrl: collected.sourceUrl,
    method: 'source-a-browser',
    urls: collected.urls,
    details: browserDetails(collected)
  });
}

async function collectSourceB(env, run, options) {
  const collected = await collectSourceBMediaUrls(env);
  await persistCaptureForManualCollection(env, run, 'source-b-browser', 'B', collected);
  return persistMergedFeed(env, {
    run,
    ...persistenceOptions(options),
    collectionDurationMs: collected.elapsedMs,
    sourceUrl: collected.sourceUrl,
    method: 'source-b-browser',
    urls: collected.urls,
    details: {
      ...browserDetails(collected),
      pagesVisited: collected.pagesVisited
    }
  });
}

async function runAndRecord(env, config) {
  const runConfig = resolveCollectionRunConfig(env, config);
  const run = await beginCollectionRun(env, runConfig);
  try {
    return await runConfig.run(env, run, runConfig);
  } catch (error) {
    if (!error?.collectionRunRecorded) {
      await recordCollectionFailure(env, { ...runConfig, run }, error).catch(() => {});
    }
    throw error;
  }
}

function adminCollectionConfig(pathname) {
  if (pathname === '/api/admin/collect-source-e') {
    return { sourceKey: 'E', sourceUrl: null, method: 'source-e-browser', run: collectSourceE };
  }
  if (pathname === '/api/admin/collect-source-a') {
    return { sourceKey: 'A', sourceUrl: null, method: 'source-a-browser', run: collectSourceA };
  }
  if (pathname === '/api/admin/collect-source-b') {
    return { sourceKey: 'B', sourceUrl: null, method: 'source-b-browser', run: collectSourceB };
  }
  return null;
}

export async function runAdminCollector(pathname, env) {
  const config = adminCollectionConfig(pathname);
  if (!config) throw new Error('Unknown collection endpoint');
  const result = await runAndRecord(env, {
    ...config,
    deferFeedMaintenance: true
  });
  const combinedFeedCount = await finalizeCompactedFeed(env);
  return { ...result, combinedFeedCount };
}

export async function runScheduledConfigs(env, configs, cron, runSource = runAndRecord) {
  const tasks = configs.map(async (config) => {
    try {
      return await runSource(env, {
        ...config,
        deferFeedMaintenance: false,
        collectionSeenKeys: new Set()
      });
    } catch (error) {
      console.error('scheduled-source-collection-failed', {
        cron,
        method: config.method,
        error: String(error?.message || error)
      });
      return null;
    }
  });
  return Promise.all(tasks);
}
