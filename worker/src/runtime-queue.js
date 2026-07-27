import { isMinutePipelineBatch, minutePipelineEnv } from './runtime-env.js';

const EMPTY_OPTIONS = Object.freeze({});
const RETRY_UNSUPPORTED_SECONDS = Object.freeze({ delaySeconds: 60 });
let minutePipelineModulePromise;

function loadMinutePipelineModule() {
  minutePipelineModulePromise ||= import('./minute-pipeline-entry.js');
  return minutePipelineModulePromise;
}

export async function runRuntimeQueue(batch, env, ctx, options = EMPTY_OPTIONS) {
  const messages = batch?.messages;
  if (!messages?.length) return;

  if (isMinutePipelineBatch(batch)) {
    const minutePipeline = await loadMinutePipelineModule();
    return minutePipeline.processMinutePipelineBatch(
      batch,
      minutePipelineEnv(env),
      ctx,
      options.minutePipelineDependencies || EMPTY_OPTIONS,
    );
  }

  let retried = 0;
  for (const message of messages) {
    console.error(JSON.stringify({
      event: 'unsupported_runtime_message_retried',
      queue: String(batch?.queue || 'unknown'),
      message_type: String(message?.body?.message_type || 'unknown'),
      attempts: Math.max(1, Math.trunc(Number(message?.attempts) || 1)),
      retry_delay_seconds: RETRY_UNSUPPORTED_SECONDS.delaySeconds,
    }));
    if (typeof message?.retry !== 'function') {
      throw new Error('unsupported runtime message cannot be retried');
    }
    message.retry(RETRY_UNSUPPORTED_SECONDS);
    retried += 1;
  }
  return {
    unsupported: true,
    queue: String(batch?.queue || 'unknown'),
    retried,
  };
}

export const runConsolidatedMonitorQueue = runRuntimeQueue;
