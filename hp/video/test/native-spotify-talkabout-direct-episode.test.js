import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const cloudResolver = readFileSync(
  new URL('../../cloud/src/spotify_talkabout_latest.ts', import.meta.url), 'utf8');
const deviceSync = readFileSync(
  new URL('../../cloud/src/device_sync.ts', import.meta.url), 'utf8');
const nativeCloud = readFileSync(
  new URL('../../native/src/spotify_cloud_playlist.inc', import.meta.url), 'utf8');
const timed = readFileSync(
  new URL('../../native/src/spotify_timed_sequence.inc', import.meta.url), 'utf8');
const rotation = readFileSync(
  new URL('../../native/src/spotify_timed_end_rotation.inc', import.meta.url), 'utf8');
const scripts = readFileSync(
  new URL('../../native/src/spotify_static_scripts.inc', import.meta.url), 'utf8');

test('cloud resolves TALKABOUT latest episode and persists it into normal device config sync', () => {
  assert.match(cloudResolver, /resolveLatestSpotifyTalkAboutEpisode/);
  assert.match(cloudResolver, /\/v1\/shows\/\$\{showId\}\/episodes/);
  assert.match(cloudResolver, /latestEpisodeFromSpotifyHtml/);
  assert.match(deviceSync, /refreshManagedSpotifyConfig/);
  assert.match(deviceSync, /resolveLatestSpotifyTalkAboutEpisode\(env, showUrl/);
  assert.match(deviceSync, /talkAbout\.episodeUrl = episodeUrl/);
  assert.match(deviceSync, /SET version=\?2,payload=\?3,updated_at=\?4/);
  assert.match(deviceSync, /WHERE device_id=\?1 AND version=\?5/);
});

test('device sync migrates only the exact legacy random pool', () => {
  assert.match(deviceSync, /LEGACY_SPOTIFY_RANDOM_TRACK_IDS/);
  assert.match(deviceSync, /SHORT_SPOTIFY_RANDOM_TRACKS/);
  assert.match(deviceSync, /tracks\.every\(\(track, index\)/);
  assert.match(deviceSync, /migrateLegacySpotifyRandomPool\(config\)/);
  assert.match(deviceSync, /random\.tracks = SHORT_SPOTIFY_RANDOM_TRACKS\.map/);
});

test('native consumes only the cloud-resolved direct episode URL', () => {
  assert.match(nativeCloud, /GetNamedString\(L"episodeUrl", L""\)/);
  assert.match(nativeCloud, /ManagedSpotifyPathFromUrl\(episodeUrl, L"\/episode\/"\)/);
  assert.doesNotMatch(nativeCloud, /ManagedSpotifyPathFromUrl\(url, L"\/show\/"\)/);
  assert.match(nativeCloud, /SpotifyPodcastTargetReady\(\) const noexcept/);
  assert.match(timed, /Navigate\(SpotifyPodcastUrl\(\)\)/);
  assert.match(timed, /source\.find\(SpotifyPodcastPath\(\)\)/);
  assert.doesNotMatch(timed, /source\.find\(L"\/episode\/"\)/);
});

test('native never searches a show page for an episode and waits if cloud target is absent', () => {
  assert.doesNotMatch(scripts, /latestEpisodeButton|a\[href\*="\/episode\/"\]/);
  assert.match(scripts, /target\.pagePath\.startsWith\('\/episode\/'\)/);
  assert.match(scripts, /location\.pathname !== target\.pagePath/);
  assert.match(rotation, /if \(!SpotifyPodcastTargetReady\(\)\) return false/);
  assert.match(rotation, /if \(!slot\.timedRotationActive \|\| !SpotifyPodcastTargetReady\(\)\) return/);
});

test('native Spotify URL validation rejects lookalike hosts', () => {
  assert.match(nativeCloud, /url\.size\(\) > host\.size\(\) && url\[host\.size\(\)\] != L'\/'/);
});
