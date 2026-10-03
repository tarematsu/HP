import { runWrangler } from './cloudflare-queues.mjs';

runWrangler(
  ['deploy', '--config', 'wrangler.scheduled-collection-jobs.jsonc'],
  { capture: true, mirror: true },
);
