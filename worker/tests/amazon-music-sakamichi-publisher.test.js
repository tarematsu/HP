import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AMAZON_MUSIC_150K_EXTENSION_STATE_KEY,
} from '../src/amazon-music-150k-extension.js';
import { AMAZON_MUSIC_DEEP_STATE_KEY } from '../src/amazon-music-rank-monitor.js';
import {
  amazonMusicSakamichiScanState,
  publishAmazonMusicSakamichiModel,
} from '../src/amazon-music-sakamichi-publisher.js';
import { isAmazonMusicTitleTrack } from '../src/amazon-music-title-tracks.js';

function fakeR2(initial = {}) {
  const store = new Map(Object.entries(initial).map(([key, value]) => [key, JSON.stringify(value)]));
  return {
    store,
    async get(key) {
      if (!store.has(key)) return null;
      const value = store.get(key);
      return {
        async json() { return JSON.parse(value); },
        async text() { return value; },
      };
    },
    async put(key, value) { store.set(key, String(value)); },
  };
}

test('current Sakamichi title tracks are classified in the Worker', () => {
  for (const [group_name, title] of [
    ['乃木坂46', '是非に及ばず'],
    ['櫻坂46', 'Lonesome rabbit'],
    ['櫻坂46', '愛MUST BE'],
    ['日向坂46', 'Kind of love'],
    ['日向坂46', 'イチャイチャ虫'],
  ]) assert.equal(isAmazonMusicTitleTrack({ group_name, title }), true);
  assert.equal(isAmazonMusicTitleTrack({ group_name: '櫻坂46', title: '愛MUST BE -OFF VOCAL ver.-' }), false);
});

test('Sakamichi scan state follows the matching 150k extension completion status', () => {
  const deep = { cycle: 7, scanned_tracks: 100000, complete: true };
  assert.deepEqual(amazonMusicSakamichiScanState(deep, { cycle: 7, status: 'collecting', scanned_tracks: 121000 }), {
    cycle: 7,
    scanned_tracks: 121000,
    target_rank: 150000,
    complete: false,
    exhausted: false,
  });
  assert.equal(amazonMusicSakamichiScanState(deep, {
    cycle: 7,
    status: 'complete',
    scanned_tracks: 150000,
    exhausted: false,
  }).complete, true);
  assert.deepEqual(amazonMusicSakamichiScanState(deep, {
    cycle: 7,
    status: 'complete',
    scanned_tracks: 143000,
    exhausted: true,
  }), {
    cycle: 7,
    scanned_tracks: 143000,
    target_rank: 150000,
    complete: true,
    exhausted: true,
  });
});

test('publisher exposes Nogizaka, Sakurazaka and Hinatazaka tracks in one read model', async () => {
  const r2 = fakeR2({
    [AMAZON_MUSIC_DEEP_STATE_KEY]: {
      cycle: 3,
      scanned_tracks: 100000,
      complete: true,
      cycle_tracks: [
        { amazon_music_id: 'NOGI1', group_name: '乃木坂46', title: '是非に及ばず', artist: '乃木坂46', rank: 120 },
        { amazon_music_id: 'SAKU1', group_name: '櫻坂46', title: '愛MUST BE', artist: '櫻坂46', rank: 240 },
        { amazon_music_id: 'HINA1', group_name: '日向坂46', title: 'イチャイチャ虫', artist: '日向坂46', rank: 360 },
      ],
    },
    [AMAZON_MUSIC_150K_EXTENSION_STATE_KEY]: {
      cycle: 3,
      status: 'complete',
      scanned_tracks: 150000,
      complete: true,
      exhausted: false,
      cycle_tracks: [
        { amazon_music_id: 'HINA2', group_name: '日向坂46', title: 'お願いバッハ！', artist: '日向坂46', rank: 120500 },
      ],
    },
  });

  const observedAt = Date.UTC(2026, 9, 1, 0, 2, 0);
  const result = await publishAmazonMusicSakamichiModel({ PAGES_RESPONSE_R2: r2 }, observedAt);
  assert.equal(result.published, true);
  assert.deepEqual(result.groups, { '乃木坂46': 1, '櫻坂46': 1, '日向坂46': 2 });

  const model = JSON.parse(r2.store.get('amazon-music/read-model/latest.json'));
  assert.equal(model.version, 3);
  assert.equal(model.scan.target_rank, 150000);
  assert.equal(model.scan.complete, true);
  assert.deepEqual(new Set(model.tracks.map((track) => track.group_name)), new Set(['乃木坂46', '櫻坂46', '日向坂46']));
  assert.equal(model.tracks.find((track) => track.amazon_music_id === 'HINA2').amazon_rank, 120500);
  assert.equal(model.tracks.find((track) => track.amazon_music_id === 'NOGI1').is_title_track, true);
  assert.equal(model.tracks.find((track) => track.amazon_music_id === 'SAKU1').is_title_track, true);
  assert.deepEqual(new Set(model.history.at(-1).tracks.map((track) => track.group_name)), new Set(['乃木坂46', '櫻坂46', '日向坂46']));
});
