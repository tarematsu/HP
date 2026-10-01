import { runWrangler } from './cloudflare-queues.mjs';

runWrangler(['queues', 'create', 'regional-music-daily'], { allowFailure: true });
runWrangler(['queues', 'create', 'regional-music-daily-dlq'], { allowFailure: true });
runWrangler(
  ['deploy', '--config', 'wrangler.regional-music.jsonc'],
  { capture: true, mirror: true },
);
