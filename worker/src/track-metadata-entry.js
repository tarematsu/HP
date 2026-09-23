import {
  repairCommittedPlaybackReadModels,
  runCommittedIsrcMetadataEnrichment,
  runCommittedSpotifyMetadataEnrichment,
} from './committed-metadata-enrichment.js';
import {
  queueNeedsPreservation,
  readModelNeedsHydration,
} from './read-model-metadata-plan.js';
import {
  hydrateReadModelMetadata,
  preserveReadModelForWrite,
  writePreparedReadModel,
} from './read-model-stages.js';
import { resolveReadModelTitleArtistIdentity } from './read-model-title-artist-identity.js';

const EMPTY_DEPENDENCIES = Object.freeze({});
const JSON_QUEUE_SEND_OPTIONS = Object.freeze({ contentType: 'json' });
const READ_MODEL_HYDRATION_RETRY_DELAYS_SECONDS = Object.freeze([2, 5, 10]);

function taskKind(body) {
  if (body?.message_type !== 'stationhead-track-metadata'
      || Number(body?.message_version) !== 1) {
    throw new Error('unsupported track metadata task');
  }
  return String(body.task || '');
}

function hydrationAttempt(body) {
  const value = Number(body?.hydration_attempt);
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
}

async function sendTrackMetadataTask(
  env,
  body,
  task,
  fields,
  dependencies,
  sendOptions = JSON_QUEUE_SEND_OPTIONS,
) {
  if (dependencies.enqueueTask) {
    await dependencies.enqueueTask(task, fields, body, sendOptions);
    return;
  }
  if (!env?.TRACK_METADATA_QUEUE?.send) throw new Error('TRACK_METADATA_QUEUE binding is missing');
  await env.TRACK_METADATA_QUEUE.send({
    message_type: 'stationhead-track-metadata',
    message_version: 1,
    task,
    ...fields,
  }, sendOptions);
}

async function enqueueReadModelStage(
  env,
  body,
  readModel,
  task,
  dependencies,
  stageOptions = {},
) {
  if (dependencies.enqueueReadModelStage) {
    await dependencies.enqueueReadModelStage(task, readModel, body, stageOptions);
    return;
  }
  if (task === 'read-model-write' && dependencies.enqueueReadModelWrite) {
    await dependencies.enqueueReadModelWrite(readModel, body);
    return;
  }
  const attempt = stageOptions.hydrationAttempt ?? hydrationAttempt(body);
  const fields = {
    job_id: body.job_id,
    observed_at: body.observed_at ?? null,
    read_model: readModel,
    ...(attempt > 0 ? { hydration_attempt: attempt } : {}),
  };
  const delaySeconds = Number(stageOptions.delaySeconds);
  const sendOptions = Number.isFinite(delaySeconds) && delaySeconds > 0
    ? { contentType: 'json', delaySeconds: Math.trunc(delaySeconds) }
    : JSON_QUEUE_SEND_OPTIONS;
  await sendTrackMetadataTask(env, body, task, fields, dependencies, sendOptions);
}

async function enqueueCommittedIsrcStage(env, body, job, dependencies) {
  if (dependencies.enqueueCommittedIsrcStage) {
    await dependencies.enqueueCommittedIsrcStage(job, body);
    return;
  }
  await sendTrackMetadataTask(env, body, 'committed-enrichment-isrc', { job }, dependencies);
}

export async function processTrackMetadataTask(env, body, dependencies = EMPTY_DEPENDENCIES) {
  const kind = taskKind(body);
  if (kind === 'committed-enrichment') {
    const job = body.job;
    if (!job?.jobId || !job?.payload) throw new Error('committed metadata job is invalid');
    if (dependencies.runCommittedMetadataEnrichment) {
      await dependencies.runCommittedMetadataEnrichment(
        env,
        [job],
        dependencies.enrichment || EMPTY_DEPENDENCIES,
      );
      return { task: kind, job_id: job.jobId };
    }
    const runner = dependencies.runCommittedSpotifyMetadataEnrichment
      || runCommittedSpotifyMetadataEnrichment;
    const saved = await runner(env, [job], dependencies.enrichment || EMPTY_DEPENDENCIES);
    const repair = dependencies.repairCommittedPlaybackReadModels
      || repairCommittedPlaybackReadModels;
    await repair(env, saved, dependencies.enrichment || EMPTY_DEPENDENCIES, true);
    await enqueueCommittedIsrcStage(env, body, job, dependencies);
    return {
      task: kind,
      job_id: job.jobId,
      pending: true,
      next_task: 'committed-enrichment-isrc',
    };
  }

  if (kind === 'committed-enrichment-isrc') {
    const job = body.job;
    if (!job?.jobId || !job?.payload) throw new Error('committed ISRC metadata job is invalid');
    const runner = dependencies.runCommittedIsrcMetadataEnrichment
      || runCommittedIsrcMetadataEnrichment;
    const saved = await runner(env, [job], dependencies.enrichment || EMPTY_DEPENDENCIES);
    const repair = dependencies.repairCommittedPlaybackReadModels
      || repairCommittedPlaybackReadModels;
    await repair(env, saved, dependencies.enrichment || EMPTY_DEPENDENCIES, true);
    return { task: kind, job_id: job.jobId, pending: false };
  }

  if (kind === 'read-model-hydration') {
    if (!body.read_model || !body.job_id) throw new Error('read-model hydration task is invalid');
    const resolveIdentity = dependencies.resolveReadModelTitleArtistIdentity
      || resolveReadModelTitleArtistIdentity;
    const identifiedReadModel = await resolveIdentity(env, body.read_model);
    if (dependencies.saveMinuteFactReadModels) {
      await dependencies.saveMinuteFactReadModels(env, identifiedReadModel, body.job_id);
      return { task: kind, job_id: body.job_id };
    }
    if (dependencies.prepareReadModelForWrite) {
      const readModel = await dependencies.prepareReadModelForWrite(env, identifiedReadModel);
      await enqueueReadModelStage(env, body, readModel, 'read-model-write', dependencies);
      return { task: kind, job_id: body.job_id, pending: true, next_task: 'read-model-write' };
    }
    const hydrate = dependencies.hydrateReadModelMetadata || hydrateReadModelMetadata;
    const readModel = await hydrate(env, identifiedReadModel);
    const nextTask = queueNeedsPreservation(readModel?.queue?.value)
      ? 'read-model-preserve'
      : 'read-model-write';
    await enqueueReadModelStage(env, body, readModel, nextTask, dependencies);
    return { task: kind, job_id: body.job_id, pending: true, next_task: nextTask };
  }

  if (kind === 'read-model-preserve') {
    if (!body.read_model || !body.job_id) throw new Error('read-model preserve task is invalid');
    const preserve = dependencies.preserveReadModelForWrite || preserveReadModelForWrite;
    const readModel = await preserve(env, body.read_model);
    const attempt = hydrationAttempt(body);
    const retryDelay = READ_MODEL_HYDRATION_RETRY_DELAYS_SECONDS[attempt];
    if (readModelNeedsHydration(readModel) && retryDelay != null) {
      const nextAttempt = attempt + 1;
      await enqueueReadModelStage(
        env,
        body,
        readModel,
        'read-model-hydration',
        dependencies,
        { hydrationAttempt: nextAttempt, delaySeconds: retryDelay },
      );
      return {
        task: kind,
        job_id: body.job_id,
        pending: true,
        next_task: 'read-model-hydration',
        hydration_attempt: nextAttempt,
        retry_after_seconds: retryDelay,
      };
    }
    await enqueueReadModelStage(env, body, readModel, 'read-model-write', dependencies);
    return { task: kind, job_id: body.job_id, pending: true, next_task: 'read-model-write' };
  }

  if (kind === 'read-model-write') {
    if (!body.read_model || !body.job_id) throw new Error('read-model write task is invalid');
    const write = dependencies.writePreparedReadModel || writePreparedReadModel;
    await write(env, body.read_model);
    return { task: kind, job_id: body.job_id, pending: false };
  }

  throw new Error(`unsupported track metadata task: ${kind || 'missing'}`);
}

async function processTrackMetadataBatch(batch, env) {
  const messages = batch.messages;
  if (!messages?.length) return;
  const message = messages[0];
  try {
    const result = await processTrackMetadataTask(env, message.body, EMPTY_DEPENDENCIES);
    console.log(JSON.stringify({ event: 'track_metadata_task_completed', ...result }));
    message.ack();
  } catch (error) {
    console.error(JSON.stringify({
      event: 'track_metadata_task_failed',
      error: String(error?.message || error).slice(0, 800),
    }));
    message.retry();
  }
}

export default {
  queue: processTrackMetadataBatch,
};
