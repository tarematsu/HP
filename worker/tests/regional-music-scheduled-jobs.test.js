import assert from 'node:assert/strict';
import test from 'node:test';

import { KKBOX_JAPANESE_HISTORY_VIEW_KEY } from '../src/kkbox-japanese-chart-history.js';
import { musicServiceReadModelKey } from '../src/music-service-read-model.js';
import { pagesR2ResponseKey } from '../src/pages-response-r2.js';
import { collectRegionalServiceToR2 } from '../src/regional-music-scheduled-jobs.js';

function memoryR2() {
  const values = new Map();
  return {
    values,
    async get(key) {
      const stored = values.get(key);
      if (!stored) return null;
      return {
        body: stored.body,
        customMetadata: stored.customMetadata,
        async json() { return JSON.parse(stored.body); },
        async text() { return stored.body; },
      };
    },
    async put(key, body, options = {}) {
      values.set(key, {
        body: String(body),
        customMetadata: options.customMetadata || {},
      });
    },
  };
}

function kkboxResponse(url) {
  const parsed = new URL(url);
  const period = parsed.pathname.endsWith('/weekly') ? 'weekly' : 'daily';
  const type = parsed.searchParams.get('type');
  const territory = parsed.searchParams.get('terr');
  const providerDate = period === 'weekly' ? '2026-10-29' : '2026-11-02';
  return new Response(JSON.stringify({
    code: '0',
    data: {
      date: providerDate,
      charts: {
        [type]: [{
          song_id: `${territory}-${period}-${type}`,
          rankings: { this_period: 5, last_period: 7 },
          song_name: '愛MUST BE',
          artist_name: '櫻坂46',
          artist_roles: '櫻坂46',
          album_name: 'Unhappy birthday構文',
        }],
      },
    },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

test('scheduled KKBOX collection refreshes Japanese chart history before publishing the read model', async () => {
  const r2 = memoryR2();
  const observedAt = Date.parse('2026-11-02T15:00:00Z');

  const result = await collectRegionalServiceToR2(
    'kkbox',
    { PAGES_RESPONSE_R2: r2 },
    observedAt,
    async (url) => kkboxResponse(url),
  );

  assert.equal(result.snapshot_status, 'ok');
  assert.equal(result.japanese_chart_history_changed, true);

  const history = await (await r2.get(KKBOX_JAPANESE_HISTORY_VIEW_KEY)).json();
  assert.equal(history.coverage.checked_requests, 8);
  assert.equal(history.coverage.series['tw/daily/song'].latest_period, '2026-11-02');
  assert.equal(history.coverage.series['tw/weekly/song'].latest_period, '2026-10-29');
  assert.equal(history.history.length, 8);

  const readModel = await r2.get(pagesR2ResponseKey(musicServiceReadModelKey('kkbox')));
  const payload = JSON.parse(await readModel.text());
  assert.equal(
    payload.kkbox_japanese_chart.coverage.series['hk/weekly/newrelease'].latest_period,
    '2026-10-29',
  );
});
