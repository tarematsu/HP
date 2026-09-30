import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function config(name) {
  return JSON.parse(readFileSync(new URL(`../${name}`, import.meta.url), 'utf8'));
}

function homepanelConfig() {
  return JSON.parse(readFileSync(new URL('../../hp/cloud/wrangler.jsonc', import.meta.url), 'utf8'));
}

test('active production Workers stay within the account-wide Free cron limit', () => {
  const configs = [
    config('wrangler.sakurazaka46jp.jsonc'),
    config('wrangler.nogizaka46smej.jsonc'),
    config('wrangler.buddies-collector.jsonc'),
    config('wrangler.ohisama-collector.jsonc'),
    config('wrangler.spotify-playcount.jsonc'),
    config('wrangler.amazon-music.jsonc'),
    config('wrangler.runtime.jsonc'),
    homepanelConfig(),
  ];
  const counts = configs.map((value) => value.triggers?.crons?.length || 0);

  // Independent Cron owners: shared Sakurazaka scheduler, Buddies, Amazon, Homepanel.
  assert.deepEqual(counts, [1, 0, 1, 0, 0, 1, 0, 1]);
  assert.equal(counts.reduce((sum, count) => sum + count, 0), 4);
  assert.equal(counts.reduce((sum, count) => sum + count, 0) <= 5, true);
});

test('shared Stationhead scheduler owns service bindings for former standalone crons', () => {
  const shared = config('wrangler.sakurazaka46jp.jsonc');
  assert.deepEqual(shared.triggers?.crons, ['* * * * *']);
  assert.deepEqual(shared.services, [
    { binding: 'NOGIZAKA_SCHEDULED', service: 'sh-nogizaka46smej' },
    { binding: 'OHISAMA_SCHEDULED', service: 'sh-ohisama-collector' },
    { binding: 'SPOTIFY_PLAYCOUNT_SCHEDULED', service: 'sh-spotify-playcount-collector' },
  ]);
});

test('runtime has no cron or offline health threshold after the Actions cutover', () => {
  const runtime = config('wrangler.runtime.jsonc');
  assert.equal(runtime.triggers, undefined);
  assert.equal(Object.hasOwn(runtime.vars, 'OTHER_CRON_STALE_MS'), false);
  assert.equal(Object.hasOwn(runtime.vars, 'RUNTIME_D1_LEASE_MS'), false);
});
