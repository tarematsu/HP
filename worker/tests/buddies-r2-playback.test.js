import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  buddiesPlaybackPeriodKey,
  transitionedBuddiesTracks,
} from '../src/buddies-playback-state.js';
import {
  materializeCurrentPlaybackWindow,
  prepareMaterializedQueue,
} from '../src/queue-materialization.js';

function queue(startTime = 1_000_000) {
  return {
    station_id: 99,
    queue_id: 7,
    start_time: startTime,
    is_paused: false,
    tracks: Array.from({ length: 10 }, (_, index) => ({
      position: index,
      queue_track_id: 100 + index,
      stationhead_track_id: 200 + index,
      spotify_id: `spotify-${index}`,
      isrc: `JPTEST00000${index}`,
      duration_ms: 180_000,
      bite_count: 10 + index,
      title: `Track ${index}`,
      artist: 'Sakurazaka46',
      album_name: 'Test',
      thumbnail_url: `https://example.test/${index}.jpg`,
    })),
  };
}

test('Buddies R2 mode keeps the actual current track plus five upcoming tracks', () => {
  const start = 1_000_000;
  const result = materializeCurrentPlaybackWindow(queue(start), start + 180_000 + 30_000, 6);
  assert.equal(result.tracks.length, 6);
  assert.equal(result.tracks[0].title, 'Track 1');
  assert.equal(result.tracks[0].position, 1);
  assert.equal(result.tracks[5].title, 'Track 6');
  assert.equal(result.source_start_time, start);
  assert.equal(result.start_time, start + 180_000);
  assert.equal(result.total_track_count, 9);
  assert.equal(result.materialized_track_count, 6);
});

test('Buddies R2 mode bypasses D1 queue materialization reads', async () => {
  const source = queue(Date.now() - 30_000);
  const analysis = { structural_hash: 'full-queue-hash' };
  const db = {
    prepare() {
      throw new Error('D1 must not be read for R2 playback materialization');
    },
  };
  const result = await prepareMaterializedQueue(db, source, analysis, {
    BUDDIES_R2_PLAYBACK_ENABLED: true,
    BUDDIES_PLAYBACK_VISIBLE_TRACKS: 6,
  });
  assert.equal(result.queue.tracks.length, 6);
  assert.equal(result.analysis, null);
});

test('Buddies playback transition can recover songs passed between five-minute polls', () => {
  const previous = [0, 1, 2, 3, 4, 5].map((index) => ({
    event_key: `event-${index}`,
    title: `Track ${index}`,
  }));
  const current = [2, 3, 4, 5, 6, 7].map((index) => ({
    event_key: `event-${index}`,
    title: `Track ${index}`,
  }));
  assert.deepEqual(
    transitionedBuddiesTracks(previous, current).map((track) => track.title),
    ['Track 1', 'Track 2'],
  );
});

test('Buddies playback day changes at 09:00 JST', () => {
  assert.equal(buddiesPlaybackPeriodKey(Date.parse('2026-10-02T08:59:59+09:00')), '2026-10-01');
  assert.equal(buddiesPlaybackPeriodKey(Date.parse('2026-10-02T09:00:00+09:00')), '2026-10-02');
});

test('prepared collector routes queue management to R2 playback mode instead of legacy queue ingest', () => {
  const source = readFileSync(new URL('../src/prepared-collector-runner.js', import.meta.url), 'utf8');
  assert.match(source, /BUDDIES_R2_PLAYBACK_ENABLED/);
  assert.match(source, /captureBuddiesPlayback\(activeEnv, queue, observedAt\)/);
  assert.match(source, /if \(r2PlaybackMode\)[\s\S]*captureBuddiesPlayback[\s\S]*else \{[\s\S]*ingest\(activeEnv, 'queue'/);
});

test('Buddies and Ohisama playback share canonical stationhead-minute track ids', () => {
  const source = readFileSync(new URL('../src/buddies-playback-state.js', import.meta.url), 'utf8');
  const migration = readFileSync(
    new URL('../../database/buddies-migrations/020_r2_playback_events.sql', import.meta.url),
    'utf8',
  );
  const wrangler = readFileSync(new URL('../wrangler.buddies-collector.jsonc', import.meta.url), 'utf8');
  assert.match(source, /resolveTracksBulk/);
  assert.match(source, /MINUTE_DB binding is missing/);
  assert.match(source, /version: 2/);
  assert.match(source, /track_id: trackId/);
  assert.match(migration, /track_id INTEGER NOT NULL/);
  assert.match(migration, /idx_sh_track_plays_track_id/);
  assert.match(wrangler, /"crons": \["\*\/5 \* \* \* \*"\]/);
});
