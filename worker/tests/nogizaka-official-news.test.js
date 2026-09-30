import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  NOGIZAKA_HANDLE,
  NOGIZAKA_NEWS_LIST_URL,
  nogizakaOfficialNewsConfig,
} from '../src/nogizaka-official-news.js';
import { scheduleTimes } from '../src/official-news-html.js';
import { runNogizakaScheduled } from '../src/nogizaka-entry.js';

function queueEnv() {
  const sent = [];
  return {
    sent,
    env: {
      HOST_MONITOR_QUEUE: {
        async send(body) { sent.push(body); },
      },
    },
  };
}

test('Nogizaka official source points at the official news feed and Stationhead handle', () => {
  assert.equal(NOGIZAKA_HANDLE, 'nogizaka46smej');
  assert.equal(NOGIZAKA_NEWS_LIST_URL, 'https://www.nogizaka46.com/s/n46/news/list');
  const config = nogizakaOfficialNewsConfig({});
  assert.equal(config.handle, 'nogizaka46smej');
  assert.equal(config.earlyWindowMs, 0);
  assert.equal(config.lateWindowMs, 90 * 60_000);
  assert.equal(config.checkIntervalMs, 60 * 60_000);
});

test('Nogizaka Japanese official-news time maps to the exact scheduled minute', () => {
  const text = '2026年10月3日（土）22時30分よりStationheadにて配信いたします。';
  assert.deepEqual(
    scheduleTimes(text, 2026, '2026-10-03'),
    [Date.UTC(2026, 9, 3, 13, 30)],
  );
});

test('scheduled minute collection takes priority and preserves a due news check', async () => {
  const { env, sent } = queueEnv();
  const scheduledAt = Date.UTC(2026, 9, 3, 13, 30);
  const result = await runNogizakaScheduled({ cron: '* * * * *', scheduledTime: scheduledAt }, env, {
    newsCheckDue: async () => true,
    stationProbeDue: async () => true,
  });

  assert.equal(result.dispatched, true);
  assert.equal(result.news_check_after_collection, true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].stage, 'station-auth');
  assert.equal(sent[0].after_news_check, true);
  assert.equal(sent[0].scheduled_at, scheduledAt);
  assert.equal(sent[0].producer_worker, 'sh-nogizaka46smej');
});

test('news-only due work enters the same staged official-news pipeline', async () => {
  const { env, sent } = queueEnv();
  const scheduledAt = Date.UTC(2026, 9, 3, 12, 0);
  await runNogizakaScheduled({ cron: '* * * * *', scheduledTime: scheduledAt }, env, {
    newsCheckDue: async () => true,
    stationProbeDue: async () => false,
  });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].stage, 'probe');
  assert.equal(sent[0].producer_worker, 'sh-nogizaka46smej');
});

test('Nogizaka Worker owns an isolated queue while scheduling is delegated', () => {
  const wrangler = JSON.parse(readFileSync(
    new URL('../wrangler.nogizaka46smej.jsonc', import.meta.url),
    'utf8',
  ));
  const migration = readFileSync(
    new URL('../../database/other-migrations/054_nogizaka46smej_official_news_collection.sql', import.meta.url),
    'utf8',
  );
  assert.equal(wrangler.name, 'sh-nogizaka46smej');
  assert.equal(wrangler.main, 'src/nogizaka-service-entry.js');
  assert.equal(wrangler.triggers, undefined);
  assert.equal(wrangler.queues.consumers[0].queue, 'stationhead-nogizaka46smej');
  assert.match(migration, /sh_nogizaka_official_news_announcements/);
  assert.match(migration, /sh_nogizaka46smej_main/);
  assert.match(migration, /sh_nogizaka46smej_chat/);
  assert.match(migration, /sh_nogizaka46smej_track_metadata/);

  const serviceEntry = readFileSync(new URL('../src/nogizaka-service-entry.js', import.meta.url), 'utf8');
  assert.match(serviceEntry, /handleInternalScheduled/);
  assert.match(serviceEntry, /NOGIZAKA_CRON/);
});
