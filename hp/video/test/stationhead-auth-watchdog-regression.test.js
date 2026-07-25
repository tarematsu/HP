import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const playerHeader = readFileSync(
  new URL('../../native/src/sh.h', import.meta.url),
  'utf8',
);
const handleSource = readFileSync(
  new URL('../../native/src/app_stationhead_handles.cpp', import.meta.url),
  'utf8',
);

test('auth host creation failure cannot leave Stationhead permanently interactive', () => {
  assert.match(
    playerHeader,
    /void RecoverUnavailableAuthorization\(\)[\s\S]*spotifyAuthorization_[\s\S]*!authController_[\s\S]*authControllerStartedAt_ == 0[\s\S]*!authPendingUrl_\.empty\(\)[\s\S]*FinishSpotifyAuthorization\(/,
  );
  assert.match(
    handleSource,
    /void StationheadHandleBase::Tick\(int64_t nowMs\)[\s\S]*player_->RecoverUnavailableAuthorization\(\);[\s\S]*player_->SpotifyAuthorizationActive\(\)/,
  );
});
