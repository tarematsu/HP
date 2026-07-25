import {
  ALL_COLLECTION_CONFIGS,
  COLLECTION_CONFIG_BY_METHOD,
  COLLECTION_CRON,
  COLLECTION_SECONDARY_CRON,
  SCHEDULED_COLLECTION_GROUPS,
  SOURCE_A_CRON,
  SOURCE_B_CRON,
  SOURCE_E_CRON
} from './scheduled-source-configs.js';
import { runCollectionConfigs } from './scheduled-group-runner.js';
import { closeStaleCollectionRuns } from './scheduled-stale-runs.js';

export {
  COLLECTION_CRON,
  COLLECTION_SECONDARY_CRON,
  SCHEDULED_COLLECTION_GROUPS,
  SOURCE_A_CRON,
  SOURCE_B_CRON,
  SOURCE_E_CRON,
  closeStaleCollectionRuns
};

export async function runScheduledCollectionMethods(env, methods, parentSignal) {
  const uniqueMethods = [...new Set(methods || [])];
  const configs = uniqueMethods
    .map((method) => COLLECTION_CONFIG_BY_METHOD.get(method))
    .filter(Boolean);
  return runCollectionConfigs(env, configs, parentSignal, 'manual-selected-source-collection');
}

export async function runAllScheduledCollections(env, parentSignal) {
  return runCollectionConfigs(env, ALL_COLLECTION_CONFIGS, parentSignal, 'manual-all-source-collection');
}

export async function runScheduledCollectionGroup(env, cron, parentSignal) {
  const group = SCHEDULED_COLLECTION_GROUPS[cron] || [];
  return runCollectionConfigs(env, group, parentSignal, cron);
}

export default {
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(runScheduledCollectionGroup(env, controller.cron, controller.signal));
  }
};
