import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = name => readFileSync(new URL(`../../native/src/${name}`, import.meta.url), 'utf8');
const handles = source('app_stationhead_handles.h');
const app = source('app.cpp');
const player = source('sh.cpp');
const shared = source('sh_shared.h');
const webview = source('sh_webview.cpp');

function section(text, start, end) {
  const from = text.indexOf(start);
  assert.notEqual(from, -1, `missing section: ${start}`);
  const to = text.indexOf(end, from + start.length);
  assert.notEqual(to, -1, `missing section terminator: ${end}`);
  return text.slice(from, to);
}

test('Stationhead handles expose interactive states as pending playback', () => {
  const handle = section(handles, 'class AppStationheadHandle final', '}  // namespace hp');
  assert.match(handle, /status\.loginRequired \|\| status\.spotifyAuthorization \|\| status\.processFailed/);
  assert.match(handle, /status\.audioPlaying = false;/);

  const tick = section(app, 'void App::Tick()', 'void App::Draw()');
  assert.match(tick, /stationheadPeers_\[i\]->Status\(\)/);
  assert.match(tick, /stationheadStatus = stationhead_->Status\(\)/);
  assert.match(tick, /ApplyStationheadWindowPlacement\(\);/);
});

test('login-required state survives audio callbacks', () => {
  const applyAudio = section(
    player, 'void StationheadPlayer::ApplyAudioPlaybackState(',
    'void StationheadPlayer::NavigateCurrentUrl(');
  assert.match(applyAudio, /preserveLoginRequired = loginRequired_/);
  assert.match(applyAudio, /status_\.loginRequired = preserveLoginRequired;/);
  assert.match(applyAudio, /Stationhead login required; audio continues/);
});

test('login detection rejects stale auth and re-arms after authentication', () => {
  const autoplay = section(shared, 'inline std::wstring StationheadAutoplayScript(',
    'inline std::wstring StationheadVolumeScript(');
  assert.match(autoplay, /__homepanelStationheadRejectedAuthorization = authorization/);
  assert.match(autoplay, /homepanel-stationhead-auth-ready/);

  const capture = section(shared, 'inline std::wstring StationheadAuthCaptureScript()',
    'inline std::wstring StationheadApiPlayStatsScript(');
  assert.match(capture, /dispatchEvent\(new Event\('homepanel-stationhead-auth-ready'\)\)/);
});

test('authenticated stats failures schedule the short retry', () => {
  const poll = section(player, 'void StationheadPlayer::PollDailyPlayStats(',
    'void StationheadPlayer::AttemptNativeStartClick(');
  assert.match(poll, /ExecuteScript/);
  assert.match(poll, /kStationheadDailyPlayStatsRetryMs/);
  assert.match(poll, /nextTickAt_ = nowMs \+ kStationheadDailyPlayStatsRetryMs/);
  assert.match(webview, /lastDailyPlayStatsAt_/);
});

test('Spotify authorization clears published login-required state', () => {
  const openAuth = section(player, 'void StationheadPlayer::OpenSpotifyAuthorization(',
    'void StationheadPlayer::FinishSpotifyAuthorization(');
  assert.match(openAuth, /loginRequired_ = false;/);
  assert.match(openAuth, /status_\.loginRequired = false;/);
});
