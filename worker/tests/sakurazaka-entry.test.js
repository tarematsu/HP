import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SAKURAZAKA_CRON,
  runSakurazakaScheduled,
} from '../src/sakurazaka-entry.js';
import { OFFICIAL_NEWS_STAGE_MESSAGE } from '../src/other-official-news-stages.js';

const SCHEDULED_AT = 1_700_000_000_000;

function dueDependencies(newsCheckDue, stationProbeDue, soloDue = false) {
  return {
    officialNewsCheckDue: async () => newsCheckDue,
    officialNewsProbeDue: async () => stationProbeDue,
    soloMonitorDue: () => soloDue,
  };
}

function queue(sent) {
  return {
    async send(body, options) {
      sent.push({ body, options });
    },
  };
}

test('Sakurazaka minute cron prioritizes raw collection', async () => {
  const sent = [];
  const result = await runSakurazakaScheduled({
    cron: SAKURAZAKA_CRON,
    scheduledTime: SCHEDULED_AT,
  }, {
    SAKURAZAKA_QUEUE: queue(sent),
  }, dueDependencies(false, true, false));

  assert.equal(SAKURAZAKA_CRON, '* * * * *');
  assert.equal(result.dispatched, true);
  assert.deepEqual(result.dispatched_stages, ['station-auth']);
  assert.equal(result.station_probe_due, true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].body.message_type, OFFICIAL_NEWS_STAGE_MESSAGE);
  assert.equal(sent[0].body.stage, 'station-auth');
  assert.equal(sent[0].body.after_news_check, false);
  assert.equal(sent[0].body.after_solo_monitor, false);
  assert.equal(sent[0].body.producer_worker, 'sh-sakurazaka46jp');
});

test('raw collection stays ahead of simultaneous news and solo work', async () => {
  const sent = [];
  const result = await runSakurazakaScheduled({
    cron: SAKURAZAKA_CRON,
    scheduledTime: SCHEDULED_AT,
  }, {
    SAKURAZAKA_QUEUE: queue(sent),
  }, dueDependencies(true, true, true));

  assert.deepEqual(result.dispatched_stages, ['station-auth']);
  assert.equal(result.news_check_after_collection, true);
  assert.equal(result.solo_monitor_due, true);
  assert.equal(sent[0].body.stage, 'station-auth');
  assert.equal(sent[0].body.after_news_check, true);
  assert.equal(sent[0].body.after_solo_monitor, true);
});

test('five-minute solo monitoring remains available when no raw/news work is due', async () => {
  const sent = [];
  const result = await runSakurazakaScheduled({
    cron: SAKURAZAKA_CRON,
    scheduledTime: SCHEDULED_AT,
  }, {
    SAKURAZAKA_QUEUE: queue(sent),
  }, dueDependencies(false, false, true));

  assert.deepEqual(result.dispatched_stages, ['solo-monitor']);
  assert.equal(sent[0].body.stage, 'solo-monitor');
});

test('Sakurazaka cron does not enqueue work when raw, news, and solo work are all idle', async () => {
  let sent = false;
  const result = await runSakurazakaScheduled({
    cron: SAKURAZAKA_CRON,
    scheduledTime: SCHEDULED_AT,
  }, {
    SAKURAZAKA_QUEUE: { async send() { sent = true; } },
  }, dueDependencies(false, false, false));

  assert.equal(sent, false);
  assert.deepEqual(result, {
    skipped: true,
    reason: 'no-due-work',
    scheduled_at: SCHEDULED_AT,
  });
});

test('Sakurazaka entry rejects the retired five-minute cron expression', async () => {
  let sent = false;
  const result = await runSakurazakaScheduled({
    cron: '*/5 * * * *',
    scheduledTime: SCHEDULED_AT,
  }, {
    SAKURAZAKA_QUEUE: { async send() { sent = true; } },
  }, dueDependencies(true, true, true));

  assert.equal(sent, false);
  assert.deepEqual(result, {
    skipped: true,
    reason: 'unsupported-cron',
    cron: '*/5 * * * *',
  });
});
