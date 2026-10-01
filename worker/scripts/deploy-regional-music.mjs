import { runWrangler } from './cloudflare-queues.mjs';
import { bootstrapProducerReadModel } from './bootstrap-producer-read-model.mjs';

runWrangler(['queues', 'create', 'regional-music-daily'], { allowFailure: true });
runWrangler(['queues', 'create', 'regional-music-daily-dlq'], { allowFailure: true });
runWrangler(
  ['deploy', '--config', 'wrangler.regional-music.jsonc'],
  { capture: true, mirror: true },
);
console.log(JSON.stringify(await bootstrapProducerReadModel('wrangler.regional-music.jsonc')));
