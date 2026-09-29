import { runWrangler } from './cloudflare-queues.mjs';

runWrangler(
  ['deploy', '--config', 'wrangler.amazon-music.jsonc'],
  { capture: true, mirror: true },
);
