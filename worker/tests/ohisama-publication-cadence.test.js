import assert from 'node:assert/strict';
import test from 'node:test';

import {
  OHISAMA_CURRENT_CADENCE_MS,
  OHISAMA_HISTORY_CADENCE_MS,
  buildOhisamaCadencedPayload,
} from '../src/ohisama-publication-cadence.js';

const START = Date.UTC(2026, 9, 1, 0, 0, 0);

function previousPayload() {
  return {
    ok: true,
    model: 'hinata',
    updated_at: START,
    latest: { online_member_count: 100 },
    history_24h: [{ observed_at: START }],
    daily: [{ period_key: '2026-09-30', stream_growth: 100 }],
    queue: [{ track_id: 1, title: 'Old current' }],
    queue_status: { current_index: 0 },
    queue_revision: 'old',
    played_tracks: { period_key: '2026-09-30', total_plays: 10 },
    played_history: [{ period_key: '2026-09-30', total_plays: 10 }],
    section_updated_at: {
      current: START,
      history: START,
    },
  };
}

function currentPayload(at) {
  return {
    ...previousPayload(),
    updated_at: at,
    latest: { online_member_count: 120 },
    history_24h: [{ observed_at: at }],
    daily: [{ period_key: '2026-10-01', stream_growth: 200 }],
  };
}

function playback() {
  return {
    queue: [{ track_id: 2, title: 'New current' }],
    queue_status: { current_index: 0 },
    queue_revision: 'new',
    daily: { period_key: '2026-10-01', total_plays: 20 },
    completed_day: null,
  };
}

test('Ohisama hinata payload keeps only current and history cadences', () => {
  assert.equal(OHISAMA_CURRENT_CADENCE_MS, 5 * 60_000);
  assert.equal(OHISAMA_HISTORY_CADENCE_MS, 24 * 60 * 60_000);
});

test('five-minute publication refreshes current data and removes duplicate playback-history fields', () => {
  const at = START + 5 * 60_000;
  const built = buildOhisamaCadencedPayload(currentPayload(at), previousPayload(), playback(), {}, at);
  assert.equal(built.payload.latest.online_member_count, 120);
  assert.equal(built.payload.queue[0].track_id, 2);
  assert.equal(built.payload.daily[0].stream_growth, 100);
  assert.equal(built.payload.played_tracks, undefined);
  assert.equal(built.payload.played_history, undefined);
  assert.equal(built.payload.likes, undefined);
  assert.deepEqual(built.refreshed, {
    current: true,
    history: false,
  });
});

test('history refreshes after 24 hours', () => {
  const at = START + 24 * 60 * 60_000;
  const built = buildOhisamaCadencedPayload(currentPayload(at), previousPayload(), playback(), {}, at);
  assert.equal(built.payload.daily[0].stream_growth, 200);
  assert.equal(built.payload.likes, undefined);
  assert.equal(built.refreshed.history, true);
});

test('UTC rollover publishes completed history even when the last publication was late', () => {
  const previous = previousPayload();
  previous.section_updated_at.history = START + 23 * 60 * 60_000;
  const at = START + 24 * 60 * 60_000 + 5 * 60_000;
  const current = currentPayload(at);
  current.daily.push({ period_key: '2026-10-02', stream_growth: 1 });
  const built = buildOhisamaCadencedPayload(current, previous, playback(), {}, at);
  assert.equal(built.refreshed.history, true);
  assert.deepEqual(built.payload.daily.map((row) => row.period_key), ['2026-10-01']);
});

