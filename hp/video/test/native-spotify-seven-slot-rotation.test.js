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
const recent = readFileSync(
  new URL('../../native/src/spotify_recent_catalog.inc', import.meta.url), 'utf8');
const rotation = readFileSync(
  new URL('../../native/src/spotify_timed_end_rotation.inc', import.meta.url), 'utf8');
const schedule = readFileSync(
  new URL('../../native/src/spotify_stagger_schedule.inc', import.meta.url), 'utf8');

test('cloud owns the requested seven-position Spotify rotation', () => {
  assert.match(catalog, /function managedSpotifySevenSlotRotation/);
  assert.match(catalog, /Lonesome Rabbit/);
  assert.match(catalog, /放課後BitterBlue/);
  assert.match(catalog, /SPOTIFY_B_ROTATION_TRACKS/);
  assert.match(catalog, /ALL_INSTRUMENTAL_SPOTIFY_ROTATION_TRACKS/);
  assert.match(catalog, /SHORT_SPOTIFY_ROTATION_TRACKS/);
  assert.match(catalog, /shortSongs\.map/);
  assert.match(catalog, /includeTalkAbout: true/);
  assert.match(admin, /rotation:structuredClone\(managedSpotifyRotation\)/);
  assert.match(deviceSync, /spotify\.rotation = managedSpotifySevenSlotRotation\(\)/);
});

test('B slot contains the requested five Spotify tracks', () => {
  for (const id of [
    '33liCluqUasE65nMv3KLLm',
    '5QnQ7m9OxSoFeSPSz8grqX',
    '2ze5Hu3eRRe6HxJTfuZaA0',
    '2CMSkSwIfnNQR7bTNFFeB5',
    '2meBhRDzQpf0ltQH11HbWG',
  ]) assert.match(catalog, new RegExp(id));
  for (const title of [
    'KAZOKU', 'コインランドリー', 'We got your back', '各駅停車', '恵まれ過ぎて',
  ]) assert.match(catalog, new RegExp(title));
});

test('C slot includes Overture and all seven Interludes', () => {
  assert.match(catalog, /Overture/);
  for (let index = 1; index <= 7; ++index) {
    assert.match(catalog, new RegExp(`Interlude #${index}`));
  }
});

test('E/F/G short-song pool includes every verified short OFF VOCAL track', () => {
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

test('native enforces no duplicate Spotify path inside one cycle', () => {
  assert.match(recent, /std::vector<std::wstring> usedPaths/);
  assert.match(recent, /std::find\(usedPaths\.begin\(\), usedPaths\.end\(\), track\.path\)/);
  assert.match(recent, /usedPaths\.push_back\(track\.path\)/);
  assert.match(recent, /size_t appended = 0/);
  assert.match(recent, /if \(!appendUnique\(std::move\(candidate\)\)\) continue/);
});

test('G mixes short songs with latest TALKABOUT and no timed interrupt remains', () => {
  assert.match(header, /bool includeTalkAbout = false/);
  assert.match(cloud, /GetNamedBoolean\(L"includeTalkAbout", false\)/);
  assert.match(recent, /group\.includeTalkAbout && SpotifyPodcastTargetReady\(\)/);
  assert.match(recent, /SpotifyPodcastUrl\(\)/);
  assert.match(recent, /SpotifyPodcastPath\(\)/);
  assert.match(rotation, /target\.path == SpotifyPodcastPath\(\)/);
  assert.match(rotation, /TimedSpotifyTarget::TalkAbout/);
  assert.doesNotMatch(header + cloud + rotation + schedule, /StartOverduePodcastBreak|podcastDueTick|intervalMinutes/);
});
