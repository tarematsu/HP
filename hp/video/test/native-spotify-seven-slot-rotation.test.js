import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const header = readFileSync(
  new URL('../../native/src/spotify_webviews.h', import.meta.url), 'utf8');
const recent = readFileSync(
  new URL('../../native/src/spotify_recent_catalog.inc', import.meta.url), 'utf8');
const rotation = readFileSync(
  new URL('../../native/src/spotify_timed_end_rotation.inc', import.meta.url), 'utf8');

test('managed Spotify rotation builds the requested A-G cycle', () => {
  assert.match(recent, /A: fixed Lonesome Rabbit/);
  assert.match(recent, /B: one shuffled selection from the five requested songs/);
  assert.match(recent, /C: one shuffled selection from Overture and every Interlude/);
  assert.match(recent, /D: fixed 放課後BitterBlue/);
  assert.match(recent, /E\/F: independent shuffled selections/);
  assert.match(recent, /G: the same short-song pool plus the cloud-resolved latest TALKABOUT/);
  assert.match(recent, /slot\.timedCycleTracks\.size\(\) == 7/);
});

test('B slot contains exactly the requested five Spotify tracks', () => {
  for (const [title, id] of [
    ['What\'s \\"KAZOKU\\"?', '33liCluqUasE65nMv3KLLm'],
    ['コインランドリー', '5QnQ7m9OxSoFeSPSz8grqX'],
    ['We got your back', '2ze5Hu3eRRe6HxJTfuZaA0'],
    ['各駅停車', '2CMSkSwIfnNQR7bTNFFeB5'],
    ['恵まれ過ぎて', '2meBhRDzQpf0ltQH11HbWG'],
  ]) {
    assert.match(recent, new RegExp(id));
    assert.ok(recent.includes(title.replaceAll('\\"', '"')) || recent.includes(title));
  }
});

test('C and short-song pools are separated from each other', () => {
  assert.match(recent, /title == L"Overture"/);
  assert.match(recent, /title\.rfind\(L"Interlude #", 0\) == 0/);
  assert.match(recent, /title\.find\(L"OFF VOCAL"\)/);
  assert.match(recent, /!IsSpotifyInstrumentalRotationTrack\(track\.title\)/);
  assert.match(recent, /!IsSpotifyOffVocalRotationTrack\(track\.title\)/);
});

test('same-cycle selections are unique by Spotify path', () => {
  assert.match(recent, /std::vector<std::wstring> usedPaths/);
  assert.match(recent, /std::find\(usedPaths\.begin\(\), usedPaths\.end\(\), track\.path\)/);
  assert.match(recent, /usedPaths\.push_back\(track\.path\)/);
});

test('G can resolve to latest TALKABOUT without legacy two-hour double play', () => {
  assert.match(header, /bool inlineTalkAboutRotation_ = false/);
  assert.match(recent, /SpotifyPodcastTargetReady\(\)/);
  assert.match(recent, /SpotifyPodcastUrl\(\)/);
  assert.match(recent, /SpotifyPodcastPath\(\)/);
  assert.match(rotation, /if \(inlineTalkAboutRotation_\) return false/);
  assert.match(rotation, /target\.path == SpotifyPodcastPath\(\)/);
  assert.match(rotation, /TimedSpotifyTarget::TalkAbout/);
});
