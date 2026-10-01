import { runWrangler } from './cloudflare-queues.mjs';

runWrangler(
  ['deploy', '--config', 'wrangler.regional-music.jsonc'],
  { capture: true, mirror: true },
);
