import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  OFFICIAL_NEWS_STAGE_MESSAGE,
  officialNewsStageTask,
  processOfficialNewsStage,
} from '../src/other-official-news-stages.js';

const BASE = Date.UTC(2026, 0, 1, 0, 20, 0);
const CANDIDATES = [
  { newsId: 'a', href: 'https://example.com/a', listTitle: 'A' },
  { newsId: 'b', href: 'https://example.com/b', listTitle: 'B' },
];

function messageStage(stage, extra = {}) {
  return {
    message_type: OFFICIAL_NEWS_STAGE_MESSAGE,
    message_version: 1,
    stage,
    scheduled_at: BASE,
    ...extra,
  };
}

test('news probe performs only the list scan and queues the first detail', async () => {
  const sent = [];
  const result = await processOfficialNewsStage({}, {
    stage: 'probe', scheduledAt: BASE, candidates: [], candidateIndex: 0,
    afterNewsCheck: false, afterSoloMonitor: false,
  }, {
    config: () => ({ marker: 'config' }),
    list: async (_env, config, now) => {
      assert.equal(config.marker, 'config');
      assert.equal(now, BASE);
      return { skipped: false, failed: false, candidates: CANDIDATES };
    },
    send: async (message) => sent.push(message),
  });
  assert.equal(result.next_stage, 'news-detail');
  assert.equal(result.candidates, 2);
  assert.equal(sent[0].stage, 'news-detail');
  assert.equal(sent[0].candidate_index, 0);
  assert.deepEqual(sent[0].candidates, CANDIDATES);
});

test('not-due and failed news checks reconcile instead of starting Stationhead collection', async () => {
  for (const value of [
    { skipped: true, failed: false, reason: 'not-due', candidates: [] },
    { skipped: true, failed: true, reason: 'official_news_list_failed' },
  ]) {
    const sent = [];
    const result = await processOfficialNewsStage({}, {
      stage: 'probe', scheduledAt: BASE, afterNewsCheck: false, afterSoloMonitor: false,
    }, {
      config: () => ({}),
      list: async () => value,
      send: async (message) => sent.push(message),
    });
    assert.equal(result.next_stage, 'reconcile');
    assert.equal(sent[0].stage, 'reconcile');
  }
});

test('detail stage processes candidates one at a time and preserves deferred solo work', async () => {
  const sent = [];
  const result = await processOfficialNewsStage({}, {
    stage: 'news-detail', scheduledAt: BASE, candidates: CANDIDATES, candidateIndex: 0,
    afterNewsCheck: false, afterSoloMonitor: true,
  }, {
    config: () => ({}),
    detail: async (_env, _config, now, candidate) => {
      assert.equal(now, BASE);
      assert.equal(candidate.newsId, 'a');
      return { skipped: false, failed: false, saved: 1 };
    },
    send: async (message) => sent.push(message),
  });
  assert.equal(result.next_stage, 'news-detail');
  assert.equal(sent[0].candidate_index, 1);
  assert.equal(sent[0].after_solo_monitor, true);
});

test('station authentication is isolated and preserves deferred news and solo work', async () => {
  const sent = [];
  const calls = [];
  const result = await processOfficialNewsStage({}, {
    stage: 'station-auth', scheduledAt: BASE, afterNewsCheck: true, afterSoloMonitor: true,
  }, {
    auth: async () => calls.push('auth'),
    send: async (message) => sent.push(message),
  });
  assert.deepEqual(calls, ['auth']);
  assert.equal(result.next_stage, 'station-main');
  assert.equal(sent[0].stage, 'station-main');
  assert.equal(sent[0].after_news_check, true);
  assert.equal(sent[0].after_solo_monitor, true);
});

test('station main raw save queues a separate D1 decode invocation', async () => {
  const sent = [];
  const result = await processOfficialNewsStage({}, {
    stage: 'station-main', scheduledAt: BASE, afterNewsCheck: true, afterSoloMonitor: true,
  }, {
    config: () => ({}),
    main: async () => ({ skipped: false }),
    send: async (message) => sent.push(message),
  });
  assert.equal(result.next_stage, 'station-decode');
  assert.equal(sent[0].stage, 'station-decode');
  assert.equal(sent[0].after_news_check, true);
  assert.equal(sent[0].after_solo_monitor, true);
});

test('decoded station routes active and inactive collection independently', async () => {
  for (const [active, stage] of [[true, 'station-chat'], [false, 'station-finalize']]) {
    const sent = [];
    const result = await processOfficialNewsStage({}, {
      stage: 'station-decode', scheduledAt: BASE, afterNewsCheck: true, afterSoloMonitor: false,
    }, {
      config: () => ({}),
      decode: async () => ({ active, station_id: 123 }),
      send: async (message) => sent.push(message),
    });
    assert.equal(result.next_stage, stage);
    assert.equal(sent[0].stage, stage);
    assert.equal(sent[0].after_news_check, true);
  }
});

test('raw chat save queues finalization without analyzing chat JSON', async () => {
  const sent = [];
  const result = await processOfficialNewsStage({}, {
    stage: 'station-chat', scheduledAt: BASE, afterNewsCheck: false, afterSoloMonitor: false,
  }, {
    config: () => ({}),
    chat: async () => ({ skipped: false }),
    send: async (message) => sent.push(message),
  });
  assert.equal(result.next_stage, 'station-finalize');
  assert.equal(sent[0].stage, 'station-finalize');
});

test('station finalization reconciles normally or starts deferred news check', async () => {
  for (const [afterNewsCheck, stage] of [[false, 'reconcile'], [true, 'probe']]) {
    const sent = [];
    const result = await processOfficialNewsStage({}, {
      stage: 'station-finalize', scheduledAt: BASE, afterNewsCheck, afterSoloMonitor: true,
    }, {
      config: () => ({}),
      finalize: async () => ({ skipped: false, active: true }),
      send: async (message) => sent.push(message),
    });
    assert.equal(result.next_stage, stage);
    assert.equal(sent[0].stage, stage);
    assert.equal(sent[0].after_solo_monitor, true);
  }
});

test('reconciliation hands off to preserved five-minute solo monitoring when requested', async () => {
  const sent = [];
  const result = await processOfficialNewsStage({ marker: true }, {
    stage: 'reconcile', scheduledAt: BASE, afterNewsCheck: false, afterSoloMonitor: true,
  }, {
    reconcile: async () => ({ skipped: false }),
    send: async (message) => sent.push(message),
  });
  assert.equal(result.pending, true);
  assert.equal(result.next_stage, 'solo-monitor');
  assert.equal(sent[0].stage, 'solo-monitor');
});

test('solo monitor runs authentication and the existing normalized monitor in its own Queue invocation', async () => {
  const calls = [];
  const result = await processOfficialNewsStage({ marker: true }, {
    stage: 'solo-monitor', scheduledAt: BASE, afterNewsCheck: false, afterSoloMonitor: false,
  }, {
    auth: async () => calls.push('auth'),
    soloMonitor: async (env, now) => {
      calls.push(['monitor', env.marker, now]);
      return { skipped: false };
    },
  });
  assert.equal(result.pending, false);
  assert.deepEqual(calls, ['auth', ['monitor', true, BASE]]);
});

test('task validation preserves raw collection and deferred solo flags', () => {
  assert.deepEqual(officialNewsStageTask(messageStage('probe')), {
    stage: 'probe', scheduledAt: BASE, candidates: [], candidateIndex: 0,
    afterNewsCheck: false, afterSoloMonitor: false,
  });
  const task = officialNewsStageTask(messageStage('station-auth', {
    after_news_check: true,
    after_solo_monitor: true,
  }));
  assert.equal(task.afterNewsCheck, true);
  assert.equal(task.afterSoloMonitor, true);
  assert.equal(officialNewsStageTask(messageStage('station-probe')).stage, 'station-main');
  for (const stage of [
    'station-auth', 'station-main', 'station-decode', 'station-chat',
    'station-finalize', 'reconcile', 'solo-monitor',
  ]) {
    assert.equal(officialNewsStageTask(messageStage(stage)).stage, stage);
  }

  const source = readFileSync(new URL('../src/sakurazaka-entry.js', import.meta.url), 'utf8');
  assert.match(source, /body\.message_type === OFFICIAL_NEWS_STAGE_MESSAGE/);
  assert.match(source, /processOfficialNewsStage/);
  assert.match(source, /for \(const message of messages\)/);
});
