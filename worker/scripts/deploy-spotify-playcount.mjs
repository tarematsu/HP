import { bootstrapSpotifyReadModel } from './bootstrap-spotify-read-model.mjs';
import { runWrangler } from './cloudflare-queues.mjs';

for (const queue of [
  'stationhead-spotify-playcount',
  'stationhead-spotify-playcount-dlq',
]) {
  runWrangler(['queues', 'create', queue], {
    capture: true,
    allowFailure: true,
  });
}

runWrangler(
  ['deploy', '--config', 'wrangler.spotify-playcount.jsonc'],
  { capture: true, mirror: true },
);

console.log(JSON.stringify(await bootstrapSpotifyReadModel()));
