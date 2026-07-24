import { readFeedState } from './d1-compaction.js';
import {
  enqueueManualImportJob,
  failManualImportJob,
  MANUAL_IMPORT_SYNC_LIMIT
} from './manual-import-jobs.js';
import { publishManualImportJob } from './manual-import-queue.js';
import { MANUAL_IMPORT_MAX_URLS } from './manual-import-limits.js';
import { persistMergedFeed } from './source-feed.js';
import { finalizeCompactedFeed } from './source-feed-compacted.js';

const MAX_SOURCE_URL_LENGTH = 2048;
const DEFAULT_IMPORT_SOURCE_URL = 'https://example.invalid/manual-import';

function intValue(value, fallback, min, max) {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function sanitizeHttpsSourceUrl(value) {
  const raw = String(value || '').trim();
  if (!raw || raw.length > MAX_SOURCE_URL_LENGTH) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:') return null;
    url.username = '';
    url.password = '';
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

export function normalizeImportSourceUrl(value) {
  return sanitizeHttpsSourceUrl(value || DEFAULT_IMPORT_SOURCE_URL);
}

export async function runManualImport(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return { status: 400, data: { ok: false, error: 'Invalid JSON' } };
  }

  if (!Array.isArray(body.urls)) {
    return { status: 400, data: { ok: false, error: 'urls must be an array' } };
  }
  const maxVideos = intValue(
    env.MAX_VIDEOS,
    MANUAL_IMPORT_MAX_URLS,
    1,
    MANUAL_IMPORT_MAX_URLS
  );
  if (body.urls.length > maxVideos) {
    return {
      status: 413,
      data: { ok: false, error: `At most ${maxVideos} URLs are allowed` }
    };
  }

  const sourceUrl = normalizeImportSourceUrl(body.sourceUrl);
  if (!sourceUrl) {
    return {
      status: 400,
      data: { ok: false, error: 'sourceUrl must be a valid HTTPS page URL of at most 2048 characters' }
    };
  }

  if (body.urls.length > MANUAL_IMPORT_SYNC_LIMIT) {
    const job = await enqueueManualImportJob(env.DB, {
      sourceUrl,
      urls: body.urls
    });
    try {
      await publishManualImportJob(env, job.jobId);
    } catch (error) {
      await failManualImportJob(env.DB, job.jobId, error).catch(() => {});
      console.error('manual-import-queue-publish-failed', {
        jobId: job.jobId,
        error: String(error?.message || error)
      });
      return {
        status: 503,
        data: { ok: false, error: 'Manual import queue is unavailable' }
      };
    }
    return {
      status: 202,
      data: {
        ok: true,
        accepted: true,
        async: true,
        ...job
      }
    };
  }

  try {
    const result = await persistMergedFeed(env, {
      sourceUrl,
      method: 'manual-browser-import',
      collectionDurationMs: 0,
      urls: body.urls,
      deferFeedMaintenance: true,
      details: { clicks: 0, elapsedMs: 0 }
    });
    if (Number(result.changed || 0) > 0) {
      result.combinedFeedCount = await finalizeCompactedFeed(env);
    } else {
      const feedState = await readFeedState(env.DB);
      result.combinedFeedCount = Number(feedState?.rowCount || 0);
    }
    return { status: 200, data: result };
  } catch (error) {
    if (/No valid video URLs/i.test(String(error?.message || error))) {
      return { status: 422, data: { ok: false, error: 'No valid video URLs were supplied' } };
    }
    throw error;
  }
}
