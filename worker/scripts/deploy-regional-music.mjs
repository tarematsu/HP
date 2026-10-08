import { runWrangler } from './cloudflare-queues.mjs';
import { bootstrapProducerReadModel } from './bootstrap-producer-read-model.mjs';

runWrangler(['queues', 'create', 'regional-music-daily'], { allowFailure: true });
runWrangler(['queues', 'create', 'regional-music-daily-dlq'], { allowFailure: true });
runWrangler(
  ['deploy', '--config', 'wrangler.regional-music.jsonc'],
  { capture: true, mirror: true },
);
const bootstrap = await bootstrapProducerReadModel('wrangler.regional-music.jsonc');
if (bootstrap.models !== 4) throw new Error('Regional read-model bootstrap did not cover all four services');
console.log(JSON.stringify(bootstrap));
