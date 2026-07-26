import { materializedResponseCadenceSeconds } from '../../site/functions/lib/api-contract.js';
import {
  runTrackHistoryCycleStep as runTrackHistoryShardStep,
  TRACK_HISTORY_ACTIVE_MINUTES,
  TRACK_HISTORY_CYCLE_MS,
  TRACK_HISTORY_STAGE_KEY,
} from './pages-track-history-cycle.js';
import {
  advanceTrackHistoryPublication,
  advanceTrackHistoryR2Publication,
  initializeTrackHistoryPublication,
} from './pages-track-history-publication.js';
import {
  createTrackHistoryPublication,
  TRACK_HISTORY_MODEL_KEY,
} from './pages-track-history-response.js';
import { promoteMaterializedD1ResponseToR2 } from './pages-response-r2.js';
import {
  finalizeTrackHistoryStatus,
  loadTrackHistoryStage,
  runLateTrackHistoryShard,
  saveTrackHistoryStage,
} from './pages-track-history-stage.js';

function disabled(value) {
  return value === false
    || value === 0
    || /^(0|false|no|off)$/i.test(String(value ?? '').trim());
}

export function trackHistoryCycleEnabled(env) {
  return !disabled(env?.PAGES_TRACK_HISTORY_CYCLE_ENABLED);
}

function disabledResult(timestamp) {
  return {
    skipped: true,
    reason: 'track-history-cycle-disabled',
    generated_at: timestamp,
    task: {
      kind: 'track-history-idle',
      key: TRACK_HISTORY_STAGE_KEY,
      disabled_by: 'PAGES_TRACK_HISTORY_CYCLE_ENABLED',
    },
    responses: [],
    failed: 0,
  };
}

function responseBase(timestamp, stage) {
  return {
    skipped: false,
    generated_at: timestamp,
    stage: {
      refresh_mode: stage.refresh_mode,
      shards: stage.tasks.length,
      published: stage.published === true,
    },
    responses: [],
    succeeded: 0,
    failed: 0,
  };
}

function publicationCompleteResult(timestamp, stage, reason = 'track-history-cycle-already-published') {
  return {
    skipped: true,
    reason,
    generated_at: timestamp,
    task: {
      kind: 'track-history-idle',
      key: TRACK_HISTORY_STAGE_KEY,
      generation: stage.generation,
    },
    stage: {
      refresh_mode: stage.refresh_mode,
      shards: stage.tasks.length,
      published: true,
    },
    responses: [],
    failed: 0,
  };
}

async function ensurePublication(env, stage, timestamp, dependencies) {
  if (stage.publication) return stage.publication;
  const finalize = dependencies.finalizeStatus || finalizeTrackHistoryStatus;
  const create = dependencies.createPublication || createTrackHistoryPublication;
  const initialize = dependencies.initializePublication || initializeTrackHistoryPublication;
  const status = await finalize(env, stage, timestamp, dependencies);
  stage.publication = await initialize(
    env.MINUTE_DB,
    create(stage, status, timestamp, env),
    dependencies,
  );
  stage.published = false;
  stage.published_at = null;
  stage.updated_at = timestamp;
  const save = dependencies.saveStage || saveTrackHistoryStage;
  await save(env.MINUTE_DB, stage, timestamp);
  return stage.publication;
}

async function advancePublicationInline(env, stage, timestamp, dependencies) {
  const publication = await ensurePublication(env, stage, timestamp, dependencies);
  if (publication.phase === 'published') {
    stage.published = true;
    stage.published_at ||= timestamp;
    stage.updated_at = timestamp;
    const save = dependencies.saveStage || saveTrackHistoryStage;
    await save(env.MINUTE_DB, stage, timestamp);
    return publicationCompleteResult(timestamp, stage, 'track-history-publication-recovered');
  }

  const r2Days = publication.phase === 'r2-days' && env?.PAGES_RESPONSE_R2;
  let result;
  if (r2Days) {
    const advanceR2 = dependencies.advanceR2Publication || advanceTrackHistoryR2Publication;
    result = await advanceR2(
      env.MINUTE_DB,
      env.PAGES_RESPONSE_R2,
      publication,
      timestamp,
      materializedResponseCadenceSeconds(TRACK_HISTORY_MODEL_KEY),
      dependencies,
    );
  } else {
    const advance = dependencies.advancePublication || advanceTrackHistoryPublication;
    result = await advance(env.MINUTE_DB, publication, timestamp, dependencies);
  }

  stage.publication = result.publication;
  stage.updated_at = timestamp;
  let promoted = null;
  if (result.published) {
    stage.published = true;
    stage.published_at = timestamp;
    if (!r2Days && env?.PAGES_RESPONSE_R2) {
      const promote = dependencies.promoteResponse || promoteMaterializedD1ResponseToR2;
      promoted = await promote(
        env.MINUTE_DB,
        env.PAGES_RESPONSE_R2,
        TRACK_HISTORY_MODEL_KEY,
        timestamp,
        materializedResponseCadenceSeconds(TRACK_HISTORY_MODEL_KEY),
      );
    }
  }
  const save = dependencies.saveStage || saveTrackHistoryStage;
  await save(env.MINUTE_DB, stage, timestamp);

  return {
    ...responseBase(timestamp, stage),
    task: {
      kind: result.published ? 'track-history-published' : 'track-history-publish-step',
      key: TRACK_HISTORY_MODEL_KEY,
      generation: stage.publication.generation,
    },
    publication: {
      action: result.action,
      phase: stage.publication.phase,
      rows: Number(result.rows || 0),
      rows_written: Number(stage.publication.rows_written || 0),
      chunks: Number(result.chunks || 0),
      days: Number(result.days || 0),
      published: result.published === true,
      storage: result.storage || promoted?.storage || (result.published ? 'd1' : null),
    },
  };
}

export async function runSplitTrackHistoryCycleStep(env, now = Date.now(), dependencies = {}) {
  const timestamp = Number(now);
  if (!trackHistoryCycleEnabled(env)) return disabledResult(timestamp);
  if (!env?.BUDDIES_DB || !env?.MINUTE_DB) {
    throw new Error('track-history cycle step is missing BUDDIES_DB or MINUTE_DB');
  }

  const load = dependencies.loadStage || loadTrackHistoryStage;
  const stage = await load(env.MINUTE_DB);
  const currentGeneration = Math.floor(timestamp / TRACK_HISTORY_CYCLE_MS) * TRACK_HISTORY_CYCLE_MS;
  if (!stage || (stage.published && Number(stage.generation) !== currentGeneration)) {
    return runTrackHistoryShardStep(env, timestamp, dependencies);
  }
  if (stage.published && stage.publication) {
    return publicationCompleteResult(timestamp, stage);
  }

  const nextTask = stage.tasks.find((task) => !stage.completed?.[task.id]);
  if (nextTask) {
    const cycleStart = Math.floor(timestamp / TRACK_HISTORY_CYCLE_MS) * TRACK_HISTORY_CYCLE_MS;
    const cycleMinute = Math.floor((timestamp - cycleStart) / 60_000);
    if (cycleMinute < TRACK_HISTORY_ACTIVE_MINUTES) {
      return runTrackHistoryShardStep(env, timestamp, dependencies);
    }
    return runLateTrackHistoryShard(env, stage, timestamp, dependencies);
  }

  return advancePublicationInline(env, stage, timestamp, dependencies);
}
