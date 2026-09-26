import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function config() {
  return JSON.parse(
    readFileSync(new URL('../wrangler.spotify-playcount.jsonc', import.meta.url), 'utf8'),
  );
}

test('Spotify collector is isolated from the realtime runtime Worker', () => {
  const value = config();
  assert.equal(value.name, 'sh-spotify-playcount-collector');
  assert.equal(value.main, 'src/spotify-playcount-entry.js');
  assert.deepEqual(value.triggers.crons, ['0 * * * *']);
  assert.deepEqual(value.d1_databases.map(({ binding }) => binding), ['OTHER_DB']);
  assert.deepEqual(value.queues.producers, [
    {
      binding: 'SPOTIFY_PLAYCOUNT_QUEUE',
      queue: 'stationhead-spotify-playcount',
    },
  ]);
  assert.equal(value.queues.consumers.length, 1);
  assert.equal(value.queues.consumers[0].queue, 'stationhead-spotify-playcount');
  assert.equal(value.queues.consumers[0].max_batch_size, 5);
  assert.equal(value.queues.consumers[0].max_concurrency, 2);
  assert.equal(value.queues.consumers[0].max_retries <= 4, true);
  assert.deepEqual(value.vars, { SPOTIFY_PLAYCOUNT_ENABLED: true });
});
