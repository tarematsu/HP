import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { captureOhisamaPlayback } from '../src/ohisama-playback.js';

const playback = readFileSync(new URL('../src/ohisama-playback.js', import.meta.url), 'utf8');
const identity = readFileSync(new URL('../src/stationhead-playback-identity.js', import.meta.url), 'utf8');
const store = readFileSync(new URL('../src/stationhead-playback-store.js', import.meta.url), 'utf8');
const schema = readFileSync(new URL('../scripts/ohisama-schema.sql', import.meta.url), 'utf8');
const deploy = readFileSync(new URL('../scripts/deploy-ohisama-collector.mjs', import.meta.url), 'utf8');
const wrangler = JSON.parse(readFileSync(new URL('../wrangler.ohisama-collector.jsonc', import.meta.url), 'utf8'));

test('Ohisama resolves playback through the central sh_tracks catalog', () => {
  assert.match(playback, /canonicalizeStationheadPlayback/);
  assert.match(identity, /resolveTracksBulk/);
  assert.match(playback, /const catalogDb = env\?\.MINUTE_DB/);
  assert.match(store, /playback track_id is unresolved/);
  assert.match(store, /event_key,played_at,period_key,station_id,track_id,track_key/);
  assert.match(playback, /station_id,track_id,track_key,spotify_id,isrc,title,artist,like_count,observed_at/);
  assert.match(identity, /unique_track_ids/);
});

test('Ohisama storage schema uses canonical track_id for new data', () => {
  assert.match(schema, /sh_track_plays[\s\S]*track_id INTEGER NOT NULL/);
  assert.match(schema, /PRIMARY KEY\(station_id, track_id\)/);
  assert.match(schema, /PRIMARY KEY\(station_id, track_id, observed_at\)/);
});

test('Ohisama deployment migrates existing storage and binds MINUTE_DB', () => {
  const minute = wrangler.d1_databases.find((binding) => binding.binding === 'MINUTE_DB');
  assert.equal(minute?.database_name, 'stationhead-minute');
  assert.match(deploy, /ensureColumn\('sh_track_plays', 'track_id', 'INTEGER'\)/);
  assert.match(deploy, /ensureColumn\('sh_track_like_current', 'track_id', 'INTEGER'\)/);
  assert.match(deploy, /ensureColumn\('sh_track_like_observations', 'track_id', 'INTEGER'\)/);
  assert.match(deploy, /idx_sh_track_plays_track_id/);
  assert.match(deploy, /idx_sh_track_like_current_track_id/);
  assert.match(deploy, /idx_sh_track_like_observations_track_id/);
  assert.match(deploy, /MINUTE_DB binding is missing from Wrangler config/);
});

test('Ohisama fails closed when the R2 playback checkpoint cannot be read', async () => {
  let d1Operations = 0;
  const env = {
    OHISAMA_DB: {
      prepare() {
        d1Operations += 1;
        throw new Error('must not write D1 after checkpoint read failure');
      },
    },
    MINUTE_DB: {
      prepare() {
        d1Operations += 1;
        throw new Error('must not hydrate after checkpoint read failure');
      },
    },
    PAGES_RESPONSE_R2: {
      async get() { throw new Error('R2 temporarily unavailable'); },
      async put() { throw new Error('must not publish after checkpoint read failure'); },
    },
  };
  const result = await captureOhisamaPlayback(env, {}, { station_id: 7 }, Date.UTC(2026, 9, 8));
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'playback-r2-unavailable');
  assert.equal(result.transitions_written, 0);
  assert.equal(result.state_saved, false);
  assert.equal(d1Operations, 0);
});
