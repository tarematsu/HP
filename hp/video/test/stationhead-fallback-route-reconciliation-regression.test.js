import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const audioLossPolicy = readFileSync(
  new URL('../../native/src/sh_audio_loss_policy.h', import.meta.url),
  'utf8',
);
const audioLossSource = readFileSync(
  new URL('../../native/src/sh_audio_loss.cpp', import.meta.url),
  'utf8',
);

test('managed fallback verifies the committed WebView route on every active tick', () => {
  assert.match(
    audioLossSource,
    /#include "sh_audio_loss_policy\.h"[\s\S]*void StationheadPlayer::EvaluateAudioLossRecovery/,
  );
  assert.match(
    audioLossSource,
    /if \(managedPlaybackFallbackActive_\) \{[\s\S]*return;/,
  );
  assert.match(
    audioLossPolicy,
    /#define managedPlaybackFallbackActive_[\s\S]*webview_->get_Source/,
  );
  assert.match(
    audioLossPolicy,
    /StationheadFallbackRouteMatches\([\s\S]*source, config_\.fallbackUrl/,
  );
  assert.match(
    audioLossPolicy,
    /NavigateStationheadUrl\([\s\S]*nowMs, config_\.fallbackUrl[\s\S]*true/,
  );
  assert.match(
    audioLossPolicy,
    /managed fallback active; correcting Stationhead route to fallback URL/,
  );
});

test('fallback route comparison accepts canonical URL differences but rejects sakuramankai', () => {
  assert.match(audioLossPolicy, /std::wstring_view StationheadRoutePath/);
  assert.match(audioLossPolicy, /find_first_of\(L"\?#"\)/);
  assert.match(audioLossPolicy, /url\.starts_with\(L"\/\/"\)/);
  assert.match(audioLossPolicy, /while \(url\.size\(\) > 1 && url\.back\(\) == L'\/'\)/);
  assert.match(
    audioLossPolicy,
    /StationheadFallbackRouteMatches\([\s\S]*stationhead\.com\/buddy46\/\?source=fallback[\s\S]*stationhead\.com\/buddy46/,
  );
  assert.match(
    audioLossPolicy,
    /!StationheadFallbackRouteMatches\([\s\S]*stationhead\.com\/sakuramankai[\s\S]*stationhead\.com\/buddy46/,
  );
});

test('route correction remains suppressed during navigation and interactive authentication', () => {
  assert.match(
    audioLossPolicy,
    /recreating_\.load\(std::memory_order_acquire\)/,
  );
  assert.match(
    audioLossPolicy,
    /navigationInFlight_\.load\(std::memory_order_acquire\)/,
  );
  assert.match(audioLossPolicy, /fallbackRouteStatus\.navigating/);
  assert.match(audioLossPolicy, /fallbackRouteStatus\.processFailed/);
  assert.match(audioLossPolicy, /fallbackRouteStatus\.spotifyAuthorization/);
  assert.match(audioLossPolicy, /fallbackRouteStatus\.loginRequired/);
});
