import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const mediaSource = readFileSync(
  new URL('../../native/src/renderer_panels/media_section.inc', import.meta.url),
  'utf8',
);

test('single-window fallback hides stale shared playback metadata', () => {
  assert.match(mediaSource, /const bool secondaryConfigured = !nativeStationhead_\.secondaryUrl\.empty\(\);/);
  assert.match(
    mediaSource,
    /const bool allStationheadsOnFallback = primaryOnFallback &&[\s\S]*\(!secondaryConfigured \|\|[\s\S]*IsStationheadFallbackUrl\(nativeStationhead_\.secondaryUrl/,
  );
  assert.match(mediaSource, /const NativePlaybackRender sharedPlayback = allStationheadsOnFallback/);
  assert.match(mediaSource, /const std::wstring title = allStationheadsOnFallback/);
});

test('music status follows the selected A or B audio source', () => {
  assert.match(
    mediaSource,
    /const bool selectedAudioPlaying = nativeStationhead_\.primaryAudioSelected[\s\S]*\? nativeStationhead_\.audioPlaying[\s\S]*: nativeStationhead_\.secondaryPlaying;/,
  );
  assert.match(mediaSource, /: selectedAudioPlaying \? L"再生中"/);
  assert.doesNotMatch(mediaSource, /: nativeStationhead_\.audioPlaying \? L"再生中"/);
});

test('interactive and failure status is not hidden by an empty-feed message', () => {
  assert.match(
    mediaSource,
    /const bool stationheadNeedsAttention = nativeStationhead_\.loginRequired \|\|[\s\S]*nativeStationhead_\.processFailed \|\| nativeStationhead_\.spotifyAuthorization;/,
  );
  assert.match(mediaSource, /nativeStationhead_\.spotifyAuthorization \? L"Spotify認証中"/);
  assert.match(
    mediaSource,
    /const std::wstring rowDetail = !stationheadNeedsAttention &&[\s\S]*sharedPlayback\.available && !sharedPlayback\.hasTrack/,
  );
});
