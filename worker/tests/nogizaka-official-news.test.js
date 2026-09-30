import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  NOGIZAKA_HANDLE,
  NOGIZAKA_NEWS_API_URL,
  NOGIZAKA_NEWS_LIST_URL,
  nogizakaEventName,
  nogizakaNewsApiCandidates,
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

test('Nogizaka official source points at the official news API and Stationhead handle', () => {
  assert.equal(NOGIZAKA_HANDLE, 'nogizaka46smej');
  assert.equal(NOGIZAKA_NEWS_LIST_URL, 'https://www.nogizaka46.com/s/n46/news/list');
  assert.equal(
    NOGIZAKA_NEWS_API_URL,
    'https://www.nogizaka46.com/s/n46/api/list/news_v2?rw=400',
  );
  const config = nogizakaOfficialNewsConfig({});
  assert.equal(config.handle, 'nogizaka46smej');
  assert.equal(config.earlyWindowMs, 0);
  assert.equal(config.lateWindowMs, 90 * 60_000);
  assert.equal(config.checkIntervalMs, 60 * 60_000);
});

test('Nogizaka news API candidate parser finds the real Stationhead announcement', () => {
  const payload = {
    count: 2,
    pages: 1,
    data: [
      {
        code: '102281',
        title: '通常のお知らせ',
        text: '通常のお知らせ本文です。',
        link_url: 'https://www.nogizaka46.com/s/n46/news/detail/102281?ima=4012',
      },
      {
        code: '102280',
        title: '乃木坂46、初の「STATIONHEAD」9/30(水)21:30～開催！',
        date: '2026/09/29 22:00:00',
        text: '■開催日時2026年9月30日（水）21:30～',
        link_url: 'https://www.nogizaka46.com/s/n46/news/detail/102280?ima=4012&pri1=202609',
      },
    ],
  };

  const candidates = nogizakaNewsApiCandidates(payload, {
    articleLimit: 200,
    bodyScanCount: 1,
  });

  assert.deepEqual(candidates, [
    {
      newsId: '102281',
      href: 'https://www.nogizaka46.com/s/n46/news/detail/102281?ima=4012',
      listTitle: '通常のお知らせ',
    },
    {
      newsId: '102280',
      href: 'https://www.nogizaka46.com/s/n46/news/detail/102280?ima=4012&pri1=202609',
      listTitle: '乃木坂46、初の「STATIONHEAD」9/30(水)21:30～開催！',
    },
  ]);
});

test('news 102280 uses the 42ndSG Under Live listening-party name', () => {
  assert.equal(
    nogizakaEventName('102280', '乃木坂46、初の「STATIONHEAD」9/30(水)21:30～開催！'),
    '「42ndSG アンダーライブ」セットリスト Stationhead リスニングパーティー',
  );
  assert.equal(
    nogizakaEventName('other', '通常タイトル 開催決定！'),
    '通常タイトル',
  );
});

test('Nogizaka news API parser rejects a silently empty or malformed feed', () => {
  assert.throws(
    () => nogizakaNewsApiCandidates({}, { articleLimit: 200, bodyScanCount: 5 }),
    /unexpected payload/,
  );
  assert.throws(
    () => nogizakaNewsApiCandidates({ data: [] }, { articleLimit: 200, bodyScanCount: 5 }),
    /no news rows/,
  );
});

test('Nogizaka Japanese official-news time maps to the exact scheduled minute', () => {
  const text = '2026年10月3日（土）22時30分よりStationheadにて配信いたします。';
  assert.deepEqual(
    scheduleTimes(text, 2026, '2026-10-03'),
    [Date.UTC(2026, 9, 3, 13, 30)],
  );
});

test('September 30 official announcement time maps to 21:30 JST', () => {
  const text = '■開催日時2026年9月30日（水）21:30～※開始時間は前後する場合がございます。';
  assert.deepEqual(
    scheduleTimes(text, 2026, '2026-09-30'),
    [Date.UTC(2026, 8, 30, 12, 30)],
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
