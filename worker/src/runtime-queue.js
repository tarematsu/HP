import { isMinutePipelineBatch, minutePipelineEnv } from './runtime-env.js';

const EMPTY_OPTIONS = Object.freeze({});
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

  for (const message of messages) {
    console.warn(JSON.stringify({
      event: 'unsupported_runtime_message_discarded',
      queue: String(batch?.queue || 'unknown'),
      message_type: String(message?.body?.message_type || 'unknown'),
    }));
    message.ack();
  }
}

export const runConsolidatedMonitorQueue = runRuntimeQueue;
