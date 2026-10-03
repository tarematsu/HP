import { runWrangler } from './cloudflare-queues.mjs';

runWrangler(
  ['deploy', '--config', 'wrangler.cron-dispatcher.jsonc'],
  { capture: true, mirror: true },
);
