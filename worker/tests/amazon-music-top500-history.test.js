import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AMAZON_MUSIC_TOP_CHECK_HISTORY_DAYS,
  AMAZON_MUSIC_TOP_CHECK_HISTORY_KEY,
  AMAZON_MUSIC_TOP_CHECK_HISTORY_MAX,
  recordAmazonTop500Check,
} from '../src/amazon-music-top500-history.js';

class FakeR2 {
  constructor() { this.values = new Map(); }
  async get(key) {
    const value = this.values.get(key);
    if (value == null) return null;
    return { async json() { return JSON.parse(value); }, async text() { return value; } };
  }
  async put(key, body) { this.values.set(key, String(body)); }
}

test('records initialized, unchanged, updated, and error top-500 checks', async () => {
  const r2 = new FakeR2();
  const env = { PAGES_RESPONSE_R2: r2 };
  await recordAmazonTop500Check(env, 1000, { initialized: true, scanned_tracks: 500, pages_scanned: 25 });
  await recordAmazonTop500Check(env, 2000, { updated: false, scanned_tracks: 500, pages_scanned: 25 });
  await recordAmazonTop500Check(env, 3000, { updated: true, changed_positions: 12, scanned_tracks: 500, pages_scanned: 25 });
  await recordAmazonTop500Check(env, 4000, { status: 'error', error: 'rate limited' });

  const state = JSON.parse(r2.values.get(AMAZON_MUSIC_TOP_CHECK_HISTORY_KEY));
  assert.equal(state.retention_days, AMAZON_MUSIC_TOP_CHECK_HISTORY_DAYS);
  assert.deepEqual(state.checks.map((item) => item.status), ['initialized', 'unchanged', 'updated', 'error']);
  assert.equal(state.checks[2].changed_positions, 12);
  assert.equal(state.checks[3].error, 'rate limited');
});

test('deduplicates scheduled time and caps retained history', async () => {
  const r2 = new FakeR2();
  const env = { PAGES_RESPONSE_R2: r2 };
  const base = Date.UTC(2026, 8, 1);
  for (let index = 0; index < AMAZON_MUSIC_TOP_CHECK_HISTORY_MAX + 20; index += 1) {
    await recordAmazonTop500Check(env, base + index * 60_000, {
      updated: index % 24 === 0,
      changed_positions: index % 24 === 0 ? 3 : 0,
      scanned_tracks: 500,
      pages_scanned: 25,
    });
  }
  const duplicateTime = base + (AMAZON_MUSIC_TOP_CHECK_HISTORY_MAX + 19) * 60_000;
  await recordAmazonTop500Check(env, duplicateTime, { updated: false, scanned_tracks: 500, pages_scanned: 25 });
  const state = JSON.parse(r2.values.get(AMAZON_MUSIC_TOP_CHECK_HISTORY_KEY));
  assert.ok(state.checks.length <= AMAZON_MUSIC_TOP_CHECK_HISTORY_MAX);
  assert.equal(state.checks.filter((item) => item.observed_at === duplicateTime).length, 1);
  assert.equal(state.checks.at(-1).status, 'unchanged');
});
