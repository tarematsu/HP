import {
  readManualImportJob,
  runManualImportJobChunk
} from './manual-import-jobs.js';

export const MANUAL_IMPORT_QUEUE_NAME = 'videoscraper-manual-imports';
export const MANUAL_IMPORT_QUEUE_BINDING = 'MANUAL_IMPORT_QUEUE';
export const MANUAL_IMPORT_RECOVERY_MESSAGE_TYPE = 'manual-import-recovery';

const JOB_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BASE_RETRY_DELAY_SECONDS = 15;
const FINALIZATION_RETRY_DELAY_SECONDS = 5;
const LOCK_RETRY_DELAY_SECONDS = 300;
const MAX_RETRY_DELAY_SECONDS = 300;
const RECOVERY_JOB_LIMIT = 100;
const ACTIVE_JOB_STATUSES = new Set(['pending', 'processing', 'finalizing']);

function normalizedJobId(value) {
  const jobId = String(value || '');
  return JOB_ID_RE.test(jobId) ? jobId : '';
}

function queueBinding(env) {
  const queue = env?.[MANUAL_IMPORT_QUEUE_BINDING];
  if (!queue?.send) throw new Error(`${MANUAL_IMPORT_QUEUE_BINDING} is not configured`);
  return queue;
}

export function manualImportQueueMessage(jobId) {
  const normalized = normalizedJobId(jobId);
  if (!normalized) throw new Error('Invalid manual import job ID');
  return { type: 'manual-import-job', jobId: normalized };
}

export async function publishManualImportJob(env, jobId, options = {}) {
  const message = manualImportQueueMessage(jobId);
  const delaySeconds = Math.max(0, Math.floor(Number(options.delaySeconds || 0)));
  if (delaySeconds > 0) {
    return queueBinding(env).send(message, { delaySeconds });
  }
  return queueBinding(env).send(message);
}

function retryDelay(message) {
  const attempts = Math.max(1, Math.floor(Number(message?.attempts || 1)));
  return Math.min(MAX_RETRY_DELAY_SECONDS, BASE_RETRY_DELAY_SECONDS * attempts);
}

function activeJob(snapshot) {
  return ACTIVE_JOB_STATUSES.has(String(snapshot?.status || ''));
}

async function readRecoverableJobIds(db) {
  const result = await db.prepare(
    `SELECT job_id AS jobId
       FROM manual_import_jobs
      WHERE status IN ('pending', 'processing', 'finalizing')
      ORDER BY CASE WHEN status = 'finalizing' THEN 0 ELSE 1 END,
               created_at,
               job_id
      LIMIT ?`
  ).bind(RECOVERY_JOB_LIMIT).all();
  return (result?.results || [])
    .map((row) => normalizedJobId(row?.jobId))
    .filter(Boolean);
}

async function consumeRecoveryMessage(message, env, dependencies) {
  const recoverJobs = dependencies.recoverJobs || readRecoverableJobIds;
  const publish = dependencies.publish || publishManualImportJob;
  try {
    const jobIds = await recoverJobs(env.DB);
    for (const jobId of jobIds) await publish(env, jobId);
    message.ack();
    console.log('manual-import-queue-recovery-complete', { recoveredJobs: jobIds.length });
    return {
      ok: true,
      recovery: true,
      recoveredJobs: jobIds.length,
      completed: true
    };
  } catch (error) {
    const delaySeconds = retryDelay(message);
    message.retry({ delaySeconds });
    console.error('manual-import-queue-recovery-retry', {
      attempts: Number(message?.attempts || 1),
      delaySeconds,
      error: String(error?.message || error)
    });
    return {
      ok: false,
      recovery: true,
      retry: true,
      recoveredJobs: 0,
      completed: false,
      delaySeconds
    };
  }
}

export async function consumeManualImportMessage(message, env, dependencies = {}) {
  if (message?.body?.type === MANUAL_IMPORT_RECOVERY_MESSAGE_TYPE) {
    return consumeRecoveryMessage(message, env, dependencies);
  }

  const jobId = normalizedJobId(message?.body?.jobId);
  if (!jobId) {
    console.error('manual-import-queue-invalid-message', { messageId: message?.id || null });
    message?.ack?.();
    return { ok: false, invalid: true, completed: false };
  }

  const runJob = dependencies.runJob || runManualImportJobChunk;
  const readJob = dependencies.readJob || readManualImportJob;
  const publish = dependencies.publish || publishManualImportJob;

  try {
    const result = await runJob(env, { jobId });
    if (result?.idle) {
      const snapshot = await readJob(env.DB, jobId).catch(() => null);
      if (activeJob(snapshot)) {
        message.retry({ delaySeconds: LOCK_RETRY_DELAY_SECONDS });
        console.log('manual-import-queue-lock-wait', {
          jobId,
          status: snapshot.status,
          delaySeconds: LOCK_RETRY_DELAY_SECONDS
        });
        return {
          ...result,
          retry: true,
          status: snapshot.status,
          jobId,
          delaySeconds: LOCK_RETRY_DELAY_SECONDS
        };
      }

      message.ack();
      return {
        ...result,
        completed: snapshot?.status === 'completed' || result?.completed === true,
        failed: snapshot?.status === 'failed',
        status: snapshot?.status || result?.status,
        jobId
      };
    }

    if (!result?.completed) {
      await publish(env, jobId, {
        delaySeconds: result?.deferred ? FINALIZATION_RETRY_DELAY_SECONDS : 0
      });
    }
    message.ack();
    return { ...result, jobId: result?.jobId || jobId };
  } catch (error) {
    const snapshot = await readJob(env.DB, jobId).catch(() => null);
    if (snapshot?.status === 'failed') {
      message.ack();
      console.error('manual-import-queue-job-failed', {
        jobId,
        error: String(error?.message || error)
      });
      return { ok: false, failed: true, completed: true, jobId };
    }

    const delaySeconds = retryDelay(message);
    message.retry({ delaySeconds });
    console.error('manual-import-queue-retry', {
      jobId,
      attempts: Number(message?.attempts || 1),
      delaySeconds,
      error: String(error?.message || error)
    });
    return { ok: false, retry: true, completed: false, jobId, delaySeconds };
  }
}

export async function consumeManualImportBatch(batch, env, dependencies = {}) {
  const results = [];
  for (const message of batch?.messages || []) {
    results.push(await consumeManualImportMessage(message, env, dependencies));
  }
  return results;
}
