import { runWrangler } from './cloudflare-queues.mjs';

// The dispatcher has a service binding to this Worker. Deploy the target first
// so a first-time rollout never leaves the binding unresolved.
runWrangler(
  ['deploy', '--config', 'wrangler.scheduled-collection-jobs.jsonc'],
  { capture: true, mirror: true },
);
runWrangler(
  ['deploy', '--config', 'wrangler.cron-dispatcher.jsonc'],
  { capture: true, mirror: true },
);
