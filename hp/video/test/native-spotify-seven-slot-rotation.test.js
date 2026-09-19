import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const catalog = readFileSync(
  new URL('../../cloud/src/spotify_random_catalog.ts', import.meta.url), 'utf8');
const admin = readFileSync(
  new URL('../../cloud/src/admin.ts', import.meta.url), 'utf8');
const deviceSync = readFileSync(
  new URL('../../cloud/src/device_sync.ts', import.meta.url), 'utf8');
const header = readFileSync(
  new URL('../../native/src/spotify_webviews.h', import.meta.url), 'utf8');
const cloud = readFileSync(
  new URL('../../native/src/spotify_cloud_playlist.inc', import.meta.url), 'utf8');
const cycle = readFileSync(
  new URL('../../native/src/spotify_rotation_cycle.inc', import.meta.url), 'utf8');
const rotation = readFileSync(
  new URL('../../native/src/spotify_timed_end_rotation.inc', import.meta.url), 'utf8');
const schedule = readFileSync(
  new URL('../../native/src/spotify_stagger_schedule.inc', import.meta.url), 'utf8');

test('cloud owns the requested four-group Spotify rotation', () => {
  assert.match(catalog, /function managedSpotifySevenSlotRotation/);
  assert.doesNotMatch(catalog, /Lonesome Rabbit/);
  assert.doesNotMatch(catalog, /放課後BitterBlue/);
  assert.doesNotMatch(catalog, /紋白蝶が確か飛んでた/);
  assert.match(catalog, /何歳の頃に戻りたいのか？/);
  assert.match(catalog, /7GcId8LLK4e33Pf3LQTb6L/);
  assert.match(catalog, /ALL_INSTRUMENTAL_SPOTIFY_ROTATION_TRACKS/);
  assert.match(catalog, /SHORT_SPOTIFY_ROTATION_TRACKS/);

  const rotationFunction = catalog.slice(
    catalog.indexOf('export function managedSpotifySevenSlotRotation()'),
  );
  assert.equal((rotationFunction.match(/mode: /g) ?? []).length, 4);
  assert.equal((rotationFunction.match(/tracks: instrumentalSongs\.map/g) ?? []).length, 1);
  assert.equal((rotationFunction.match(/tracks: shortSongs\.map/g) ?? []).length, 1);
  assert.match(
    rotationFunction,
    /mode: "fixed",\s*tracks: \[spotifyRotationTrack\("何歳の頃に戻りたいのか？", "7GcId8LLK4e33Pf3LQTb6L"\)\]/,
  );

  const a = rotationFunction.indexOf('愛MUST BE');
  const b = rotationFunction.indexOf('tracks: instrumentalSongs.map');
  const d = rotationFunction.indexOf('何歳の頃に戻りたいのか？');
  const e = rotationFunction.indexOf('tracks: shortSongs.map');
  assert.ok(a >= 0 && a < b && b < d && d < e);

  assert.match(admin, /rotation:structuredClone\(managedSpotifyRotation\)/);
  assert.match(deviceSync, /const nextRotation = managedSpotifySevenSlotRotation\(\)/);
  assert.match(deviceSync, /spotify\.rotation = nextRotation/);
});

test('E uses the filtered short-song pool once per cycle', () => {
  const rotationFunction = catalog.slice(
    catalog.indexOf('export function managedSpotifySevenSlotRotation()'),
  );
  assert.equal((rotationFunction.match(/tracks: shortSongs\.map/g) ?? []).length, 1);
});

test('B uses Overture plus all seven Interludes', () => {
  assert.match(catalog, /Overture/);
  for (let index = 1; index <= 7; ++index) {
    assert.match(catalog, new RegExp(`Interlude #${index}`));
  }
  assert.equal(
    (catalog.match(/tracks: instrumentalSongs\.map/g) ?? []).length,
    1,
  );
});

test('catalog retains managed short OFF VOCAL tracks for migration', () => {
  assert.match(
    catalog,
    /SHORT_SPOTIFY_ROTATION_TRACKS\s*=\s*\[\s*\.\.\.SHORT_SPOTIFY_RANDOM_TRACKS,\s*\.\.\.OFF_VOCAL_SPOTIFY_RANDOM_TRACKS,/s,
  );
  assert.match(
    catalog,
    /const shortSongs = rotationTracks\(SHORT_SPOTIFY_ROTATION_TRACKS\)/,
  );
  for (const id of [
    '04nk2Ee7qSnNwn6OG2hl3Q',
    '4hVECXakmpdqigQq1mJwNg',
    '51nXGT2UTljN9BdOgn0Utw',
    '1R5rm05YeYZSJiGzZPZx8l',
    '17PV1rxc1KbMOTRKSRt2hd',
    '54VmTDaOAl0LVlOmYOFuFi',
    '5TaAgmUQuhJw4bGW4dg3KI',
  ]) assert.match(catalog, new RegExp(id));
});

test('catalog retains additional verified vocal tracks for migration', () => {
  assert.match(catalog, /ADDITIONAL_SHORT_SPOTIFY_RANDOM_TRACKS/);
  assert.match(
    catalog,
    /SHORT_SPOTIFY_ROTATION_TRACKS\s*=\s*\[[\s\S]*\.\.\.ADDITIONAL_SHORT_SPOTIFY_RANDOM_TRACKS,/,
  );
  for (const id of [
    '44sj7vChwZRYQ0Oz9AFyP2',
    '5vOABxcejLNdoyLh7JRtjM',
    '3CzKqb5U3GlxUhoJGv1BZf',
    '7jLbrfs3YtWO232XEU3iD1',
    '5z8xkccoi9bnA8SGf2VQnk',
    '6oZVLkbhLB3qyikq0eNlEy',
    '31vLfN5bNOpasgULiqSbLx',
    '37h3M4ZYJgSRy0cXArsH59',
    '59G1ePHebLtol0u5upRFSZ',
    '2K6uY7BaeOfuPwJNOVF3ht',
    '1QidgC1vyuG6053IY5S4UG',
  ]) assert.match(catalog, new RegExp(id));
  assert.match(catalog, /ピッカーン！/);
});

test('E excludes the eight removed longest tracks', () => {
  const exclusions = catalog.slice(
    catalog.indexOf('const SHORT_SPOTIFY_ROTATION_EXCLUDED_IDS'),
    catalog.indexOf('// E uses the filtered short music pool'),
  );
  for (const id of [
    '7vvZ1QHTdkoEXBiOBdxdIo',
    '3HdmFZGqZLNiCAfiNj4N84',
    '51nXGT2UTljN9BdOgn0Utw',
    '5DrxCKjopmd7UL1pJWqBHK',
    '2K6uY7BaeOfuPwJNOVF3ht',
    '5TaAgmUQuhJw4bGW4dg3KI',
    '2hi8kIoKC8tRMDajdkoYFL',
    '4hVECXakmpdqigQq1mJwNg',
  ]) assert.match(exclusions, new RegExp(id));
  assert.match(
    catalog,
    /\.filter\(\(\[, id\]\) => !SHORT_SPOTIFY_ROTATION_EXCLUDED_IDS\.has\(id\)\)/,
  );
});

test('native enforces no duplicate Spotify path inside one cycle', () => {
  assert.match(cycle, /std::vector<std::wstring> usedPaths/);
  assert.match(cycle, /std::find\(usedPaths\.begin\(\), usedPaths\.end\(\), track\.path\)/);
  assert.match(cycle, /usedPaths\.push_back\(track\.path\)/);
  assert.match(cycle, /size_t appended = 0/);
  assert.match(cycle, /if \(!appendUnique\(std::move\(candidate\)\)\) continue/);
});

test('E uses the short-song music pool and no podcast path remains', () => {
  assert.equal((catalog.match(/tracks: shortSongs\.map/g) ?? []).length, 1);
  const spotifySources = catalog + admin + deviceSync + header + cloud + cycle + rotation + schedule;
  assert.doesNotMatch(
    spotifySources,
    /TalkAbout|TALKABOUT|talkAbout|includeTalkAbout|SpotifyPodcast|podcastBreakActive/,
  );
});
