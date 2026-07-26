import recoveryApp, {
  BUDDIES_RECOVERY_QUEUE_NAMES,
  runBuddiesRecoveryQueue,
} from './buddies-recovery-core.js';
import { queueAttributedEnv } from './queue-attribution.js';

export {
  BUDDIES_RECOVERY_QUEUE_NAMES,
  runBuddiesRecoveryQueue,
};

export function runAttributedBuddiesRecoveryQueue(batch, env, ctx, dependencies) {
  return runBuddiesRecoveryQueue(
    batch,
    queueAttributedEnv(env, 'sh-buddies-recovery'),
    ctx,
    dependencies,
  );
}

export default {
  ...recoveryApp,
  queue: runAttributedBuddiesRecoveryQueue,
};
