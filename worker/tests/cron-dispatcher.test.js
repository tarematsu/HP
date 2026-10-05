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

function doNamespace(name, calls) {
  return {
    getByName(instance) {
      return {
        async fetch(url, init = {}) {
          calls.push({
            name,
            instance,
            url,
            body: init.body ? JSON.parse(init.body) : undefined,
          });
          return new Response('ok');
        },
      };
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
    SCHEDULED_COLLECTION_JOBS: scheduledService('collection-jobs', calls),
    HOMEPANEL_SCHEDULER_COORDINATOR: doNamespace('homepanel-scheduler', calls),
    HOMEPANEL_VIDEO_FEED_COORDINATOR: doNamespace('homepanel-video', calls),
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
    { binding: 'SCHEDULED_COLLECTION_JOBS', service: 'sh-scheduled-collection-jobs' },
  ]);
  assert.deepEqual(config.durable_objects.bindings.map(({ name, script_name }) => ({ name, script_name })), [
    { name: 'HOMEPANEL_SCHEDULER_COORDINATOR', script_name: 'homepanel-cloud' },
    { name: 'HOMEPANEL_VIDEO_FEED_COORDINATOR', script_name: 'homepanel-cloud' },
  ]);
});

test('minute routing keeps Nogizaka shared and staggers Ohisama away from Buddies', async () => {
  const calls = [];
  await runCronDispatcher({ scheduledTime: Date.UTC(2026, 9, 4, 10, 2) }, env(calls));
  assert.deepEqual(calls.map(({ name }) => name), ['collection-jobs', 'nogizaka']);
  assert.equal(calls[0].body.cron, '* * * * *');

  calls.length = 0;
  await runCronDispatcher({ scheduledTime: Date.UTC(2026, 9, 4, 10, 1) }, env(calls));
  assert.deepEqual(calls.map(({ name }) => name), ['collection-jobs', 'nogizaka', 'ohisama']);
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

test('regional and Stationhead collection schedules are dispatched to target Workers', async () => {
  const calls = [];
  // Thursday 18:30 JST: QQ toplist poll, staggered after the 18:00 base collection.
  await runCronDispatcher({ scheduledTime: Date.UTC(2026, 9, 8, 9, 30) }, env(calls));
  assert.deepEqual(calls.map(({ name }) => name), ['collection-jobs', 'nogizaka', 'regional']);
  assert.equal(calls.at(-1).body.cron, '30 9-21 * * 4');

  calls.length = 0;
  // Monday 21:17 JST: weekly Stationhead leaderboard import.
  await runCronDispatcher({ scheduledTime: Date.UTC(2026, 9, 5, 12, 17) }, env(calls));
  assert.deepEqual(calls.map(({ name }) => name), ['collection-jobs', 'nogizaka', 'collection-jobs']);
  assert.equal(calls.at(-1).body.cron, '17 12 * * 1');
});

test('hourly HomePanel watchdog forces radar due without restoring a HomePanel Worker Cron', async () => {
  const calls = [];
  await runCronDispatcher({ scheduledTime: Date.UTC(2026, 9, 6, 14, 0) }, env(calls));
  const homePanelCalls = calls.filter((call) => call.name.startsWith('homepanel'));
  assert.equal(homePanelCalls.length, 3);
  assert.deepEqual(homePanelCalls[0], {
    name: 'homepanel-scheduler',
    instance: 'global',
    url: 'https://scheduler.internal/wake',
    body: { names: ['radar'] },
  });
  assert.equal(config.durable_objects.bindings[0].script_name, 'homepanel-cloud');
});

test('daily midnight JST dispatches followers and YouTube Music from the shared Worker', async () => {
  const calls = [];
  await runCronDispatcher({ scheduledTime: Date.UTC(2026, 9, 6, 15, 0) }, env(calls));
  const serviceCalls = calls.filter((call) => ['nogizaka', 'regional', 'collection-jobs'].includes(call.name));
  assert.deepEqual(serviceCalls.map(({ name }) => name), ['collection-jobs', 'nogizaka', 'regional', 'collection-jobs']);
  assert.equal(serviceCalls[2].body.cron, '0 15 * * *');
  assert.equal(serviceCalls[3].body.cron, '0 15 * * *');
  assert.equal(calls.filter((call) => call.name.startsWith('homepanel')).length, 3);
});