import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  amazonMusicDue,
  CRON_DISPATCHER_CRON,
  runCronDispatcher,
} from '../src/cron-dispatcher-entry.js';

const config = JSON.parse(readFileSync(new URL('../wrangler.cron-dispatcher.jsonc', import.meta.url), 'utf8'));

function scheduledService(name, calls) {
  return {
    async fetch(url, init) {
      calls.push({ name, url, body: JSON.parse(init.body) });
      return Response.json({ ok: true });
    },
  };
}

function env(calls) {
  return {
    NOGIZAKA_SCHEDULED: scheduledService('nogizaka', calls),
    OHISAMA_SCHEDULED: scheduledService('ohisama', calls),
    SPOTIFY_PLAYCOUNT_SCHEDULED: scheduledService('spotify', calls),
    AMAZON_MUSIC_SCHEDULED: scheduledService('amazon', calls),
    REGIONAL_MUSIC_SCHEDULED: scheduledService('regional', calls),
  };
}

test('generic dispatcher is the only shared Cron owner and has no data bindings', () => {
  assert.equal(config.name, 'sh-cron-dispatcher');
  assert.equal(config.main, 'src/cron-dispatcher-entry.js');
  assert.deepEqual(config.triggers?.crons, [CRON_DISPATCHER_CRON]);
  assert.equal(config.d1_databases, undefined);
  assert.equal(config.r2_buckets, undefined);
  assert.equal(config.queues, undefined);
  assert.deepEqual(config.services, [
    { binding: 'NOGIZAKA_SCHEDULED', service: 'sh-nogizaka46smej' },
    { binding: 'OHISAMA_SCHEDULED', service: 'sh-ohisama-collector' },
    { binding: 'SPOTIFY_PLAYCOUNT_SCHEDULED', service: 'sh-spotify-playcount-collector' },
    { binding: 'AMAZON_MUSIC_SCHEDULED', service: 'sh-amazon-music-collector' },
    { binding: 'REGIONAL_MUSIC_SCHEDULED', service: 'sh-regional-music-collector' },
  ]);
  assert.deepEqual(config.durable_objects.bindings.map(({ name, script_name }) => ({ name, script_name })), [
    { name: 'HOMEPANEL_SCHEDULER_COORDINATOR', script_name: 'homepanel-cloud' },
    { name: 'HOMEPANEL_VIDEO_FEED_COORDINATOR', script_name: 'homepanel-cloud' },
  ]);
});

test('minute routing keeps Nogizaka shared and staggers Ohisama away from Buddies', async () => {
  const calls = [];
  await runCronDispatcher({ scheduledTime: Date.UTC(2026, 9, 4, 10, 2) }, env(calls));
  assert.deepEqual(calls.map(({ name }) => name), ['nogizaka']);

  calls.length = 0;
  await runCronDispatcher({ scheduledTime: Date.UTC(2026, 9, 4, 10, 1) }, env(calls));
  assert.deepEqual(calls.map(({ name }) => name), ['nogizaka', 'ohisama']);
});

test('Amazon and Apple dispatcher window preserves 05:00 and 06:00 JST schedules', () => {
  const at = (hour, minute) => Date.UTC(2026, 9, 4, hour, minute);
  assert.equal(amazonMusicDue(at(20, 0)), true);
  assert.equal(amazonMusicDue(at(20, 10)), true);
  assert.equal(amazonMusicDue(at(21, 0)), true);
  assert.equal(amazonMusicDue(at(21, 15)), false);
  assert.equal(amazonMusicDue(at(23, 50)), true);
  assert.equal(amazonMusicDue(at(0, 0)), false);
});
