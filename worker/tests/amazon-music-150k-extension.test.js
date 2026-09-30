import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AMAZON_MUSIC_150K_EXTENSION_STATE_KEY,
  amazon150kExtensionPlan,
  captureAmazon150kBoundaryCheckpoint,
} from '../src/amazon-music-150k-extension.js';
import { AMAZON_MUSIC_DEEP_STATE_KEY } from '../src/amazon-music-rank-monitor.js';

class FakeR2 {
  constructor() {
    this.values = new Map();
  }

  async get(key) {
    const value = this.values.get(key);
    if (value == null) return null;
    return {
      async json() { return JSON.parse(value); },
      async text() { return value; },
    };
  }

  async put(key, body) {
    this.values.set(key, String(body));
  }
}

test('legacy completed 100k state extends by seeking the lost boundary token without resetting rank data', () => {
  const deep = {
    cycle: 7,
    scanned_tracks: 100_000,
    next_url: null,
    complete: true,
    cycle_tracks: [{ amazon_music_id: 'SAKURA1', rank: 88_888, group_name: '櫻坂46' }],
  };
  const plan = amazon150kExtensionPlan(deep, null);
  assert.equal(plan.eligible, true);
  assert.equal(plan.cycle, 7);
  assert.equal(plan.status, 'seeking');
  assert.equal(plan.seek_scanned_tracks, 0);
  assert.equal(plan.scanned_tracks, 100_000);
});

test('saved pre-100k checkpoint is reused when the completed base scan discarded its next url', () => {
  const deep = { cycle: 8, scanned_tracks: 100_000, next_url: null, complete: true };
  const extension = {
    cycle: 8,
    status: 'armed',
    seek_scanned_tracks: 96_000,
    seek_next_url: 'https://example.invalid/next-96000',
  };
  const plan = amazon150kExtensionPlan(deep, extension);
  assert.equal(plan.eligible, true);
  assert.equal(plan.status, 'seeking');
  assert.equal(plan.seek_scanned_tracks, 96_000);
  assert.equal(plan.seek_next_url, 'https://example.invalid/next-96000');
});

test('completed state with a retained continuation token can collect from 100001 immediately', () => {
  const deep = {
    cycle: 9,
    scanned_tracks: 100_000,
    next_url: 'https://example.invalid/next-100000',
    complete: true,
  };
  const plan = amazon150kExtensionPlan(deep, null);
  assert.equal(plan.eligible, true);
  assert.equal(plan.status, 'collecting');
  assert.equal(plan.scanned_tracks, 100_000);
  assert.equal(plan.next_url, 'https://example.invalid/next-100000');
});

test('incomplete base scan checkpoint is armed for the future 150k extension', async () => {
  const r2 = new FakeR2();
  r2.values.set(AMAZON_MUSIC_DEEP_STATE_KEY, JSON.stringify({
    cycle: 10,
    scanned_tracks: 94_000,
    next_url: 'https://example.invalid/next-94000',
    complete: false,
  }));

  const result = await captureAmazon150kBoundaryCheckpoint({ PAGES_RESPONSE_R2: r2 }, 123_000);
  assert.equal(result.boundary_checkpoint_captured, true);
  assert.equal(result.boundary_checkpoint_rank, 94_000);

  const saved = JSON.parse(r2.values.get(AMAZON_MUSIC_150K_EXTENSION_STATE_KEY));
  assert.equal(saved.status, 'armed');
  assert.equal(saved.cycle, 10);
  assert.equal(saved.seek_scanned_tracks, 94_000);
  assert.equal(saved.seek_next_url, 'https://example.invalid/next-94000');
});

test('150k completed state does not start another extension', () => {
  const plan = amazon150kExtensionPlan({
    cycle: 11,
    scanned_tracks: 150_000,
    complete: true,
  });
  assert.deepEqual(plan, { eligible: false, reason: 'target-already-complete' });
});
