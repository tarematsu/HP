import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function config(name) {
  return JSON.parse(readFileSync(new URL(`../${name}`, import.meta.url), 'utf8'));
}

function homepanelConfig() {
  return JSON.parse(readFileSync(new URL('../../hp/cloud/wrangler.jsonc', import.meta.url), 'utf8'));
}

test('active production Workers keep only Sakurazaka, Buddies, and generic dispatcher crons', () => {
  const configs = [
    config('wrangler.sakurazaka46jp.jsonc'),
    config('wrangler.nogizaka46smej.jsonc'),
    config('wrangler.buddies-collector.jsonc'),
    config('wrangler.ohisama-collector.jsonc'),
    config('wrangler.spotify-playcount.jsonc'),
    config('wrangler.amazon-music.jsonc'),
    config('wrangler.regional-music.jsonc'),
    config('wrangler.cron-dispatcher.jsonc'),
    config('wrangler.runtime.jsonc'),
    homepanelConfig(),
  ];
  const counts = configs.map((value) => value.triggers?.crons?.length || 0);

  assert.deepEqual(counts, [1, 0, 1, 0, 0, 0, 0, 1, 0, 0]);
  assert.equal(counts.reduce((sum, count) => sum + count, 0), 3);
  assert.equal(counts.reduce((sum, count) => sum + count, 0) <= 5, true);
});

test('generic dispatcher owns shared service bindings while Sakurazaka stays isolated', () => {
  const sakurazaka = config('wrangler.sakurazaka46jp.jsonc');
  const shared = config('wrangler.cron-dispatcher.jsonc');
  assert.deepEqual(sakurazaka.triggers?.crons, ['* * * * *']);
  assert.equal(sakurazaka.services, undefined);
  assert.deepEqual(shared.triggers?.crons, ['* * * * *']);
  assert.deepEqual(shared.services, [
    { binding: 'NOGIZAKA_SCHEDULED', service: 'sh-nogizaka46smej' },
    { binding: 'OHISAMA_SCHEDULED', service: 'sh-ohisama-collector' },
    { binding: 'SPOTIFY_PLAYCOUNT_SCHEDULED', service: 'sh-spotify-playcount-collector' },
    { binding: 'AMAZON_MUSIC_SCHEDULED', service: 'sh-amazon-music-collector' },
    { binding: 'REGIONAL_MUSIC_SCHEDULED', service: 'sh-regional-music-collector' },
  ]);
});

test('runtime has no cron or offline health threshold after the Actions cutover', () => {
  const runtime = config('wrangler.runtime.jsonc');
  assert.equal(runtime.triggers, undefined);
  assert.equal(Object.hasOwn(runtime.vars, 'OTHER_CRON_STALE_MS'), false);
  assert.equal(Object.hasOwn(runtime.vars, 'RUNTIME_D1_LEASE_MS'), false);
});
