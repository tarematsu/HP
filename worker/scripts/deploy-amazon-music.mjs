import { runWrangler } from './cloudflare-queues.mjs';

runWrangler(['queues', 'create', 'music-playlist-refresh'], { allowFailure: true });
runWrangler(['queues', 'create', 'music-playlist-refresh-dlq'], { allowFailure: true });
runWrangler(
  ['deploy', '--config', 'wrangler.amazon-music.jsonc'],
  { capture: true, mirror: true },
);
