import assert from 'node:assert/strict';
import test from 'node:test';

import { collectKkboxJapaneseHistory } from '../scripts/backfill-kkbox-japanese-history-actions.mjs';
import {
  kkboxHistoryRecord,
  mergeKkboxJapaneseHistory,
  upsertKkboxJapaneseHistoryArtifacts,
} from '../src/kkbox-japanese-chart-history.js';

const chart = { territory: 'tw', period: 'weekly', type: 'newrelease' };
const result = {
  provider_date: '2024-10-03',
  source_url: 'https://example.invalid/chart',
  source_rows: 50,
  entries: [{
    track_id: 'track-1',
    rank: 32,
    previous_rank: 40,
    canonical_artists: ['sakurazaka46'],
    title: 'I want tomorrow to come',
    artist_name: '櫻坂46',
  }],
};

test('KKBOX history view keeps checked request coverage separate from matched entries', () => {
  const matched = kkboxHistoryRecord(chart, result, '2024-10-03');
  const empty = kkboxHistoryRecord(chart, { ...result, provider_date: '2024-10-10', entries: [] }, '2024-10-10');
  const view = mergeKkboxJapaneseHistory(null, [matched, empty], 1000);
  assert.equal(view.coverage.checked_requests, 2);
  assert.equal(view.coverage.entries, 1);
  assert.equal(view.history[0].rank, 32);
  assert.equal(view.history[0].canonical_artists[0], 'sakurazaka46');
  assert.equal(view.coverage.series['tw/weekly/newrelease'].checked_requests, 2);
});

test('KKBOX history upsert is idempotent and replaces the same requested period', async () => {
  const store = new Map();
  const load = async (key) => store.get(key) || null;
  const save = async (key, value) => store.set(key, value);
  const first = kkboxHistoryRecord(chart, result, '2024-10-03');
  const one = await upsertKkboxJapaneseHistoryArtifacts({ load, save, records: [first], updatedAt: 1000 });
  assert.equal(one.changed, true);
  const two = await upsertKkboxJapaneseHistoryArtifacts({ load, save, records: [first], updatedAt: 2000 });
  assert.equal(two.changed, false);
  const changed = kkboxHistoryRecord(chart, {
    ...result,
    entries: [{ ...result.entries[0], rank: 11 }],
  }, '2024-10-03');
  const three = await upsertKkboxJapaneseHistoryArtifacts({ load, save, records: [changed], updatedAt: 3000 });
  assert.equal(three.changed, true);
  assert.equal(three.view.history[0].rank, 11);
  assert.equal(three.view.periods.length, 1);
});

test('KKBOX history backfill caps each run and leaves remaining requests for the next run', async () => {
  const urls = [];
  const progress = [];
  const fetchImpl = async (url) => {
    urls.push(String(url));
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({
        code: 0,
        data: {
          date: '2024-10-03',
          charts: { song: [] },
        },
      }),
    };
  };

  const view = await collectKkboxJapaneseHistory({
    start: '2024-10-03',
    end: '2024-10-03',
    territories: ['tw'],
    periods: ['daily'],
    types: ['song', 'newrelease'],
    delayMs: 0,
    maxRequests: 1,
    fetchImpl,
    onProgress: (event) => progress.push(event),
  });

  assert.equal(urls.length, 1);
  assert.equal(view.coverage.checked_requests, 1);
  assert.equal(progress.length, 1);
  assert.equal(progress[0].total, 1);
  assert.equal(progress[0].remaining, 1);
});
