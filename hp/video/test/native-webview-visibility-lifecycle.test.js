import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = name => readFileSync(
  new URL(`../../native/src/${name}`, import.meta.url), 'utf8');

const stationhead = source('sh.cpp');
const stationheadLayout = source('sh_layout.cpp');
const stationheadPopup = source('sh_webview.cpp');
const stationheadBoundary = source('sh_track_boundary_script.h');
const stationheadVisibility = source('sh_playback_visibility.h');
const spotifyClick = source('spotify_background_click.inc');
const spotifyRotation = source('spotify_timed_end_rotation.inc');

function section(text, start, end) {
  const startAt = text.indexOf(start);
  assert.notEqual(startAt, -1, `missing section: ${start}`);
  const endAt = text.indexOf(end, startAt + start.length);
  assert.notEqual(endAt, -1, `missing section terminator: ${end}`);
  return text.slice(startAt, endAt);
}

test('Stationhead playback controller starts visible while auth controllers may start hidden', () => {
  const create = section(
    stationhead,
    'void StationheadPlayer::Create() {',
    'void StationheadPlayer::CompletePendingAuthPopupDeferral()',
  );
  assert.match(create, /controller_->put_IsVisible\(TRUE\)/);
  assert.doesNotMatch(create, /controller_->put_IsVisible\(FALSE\)/);

  const auth = section(
    stationhead,
    'void StationheadPlayer::EnsureAuthController',
    'void StationheadPlayer::Tick(',
  );
  assert.match(auth, /authController_->put_IsVisible\(FALSE\)/);
  assert.match(stationheadPopup, /authController_->put_IsVisible\(FALSE\)/);
});

test('Stationhead playback rendering suppression is disabled', () => {
  assert.match(
    stationheadVisibility,
    /SetStationheadPlaybackRenderingSuppressed\([\s\S]*?\) noexcept \{\}/,
  );
  assert.match(
    stationheadVisibility,
    /StationheadPlaybackRenderingSuppressed\([\s\S]*?\) noexcept \{\s*return false;\s*\}/,
  );
});

test('Stationhead layout keeps full-size playback visible in foreground or background recovery', () => {
  const layout = section(
    stationheadLayout,
    'void ApplyStationheadChildLayout(',
    '\n}\n\n}\n\nbool StationheadPlayer::EnsureHostWindow()',
  );
  assert.match(
    layout,
    /const BOOL playbackControllerVisible\s*=\s*playbackFullSize \|\|\s*!StationheadPlaybackRenderingSuppressed\(controller\)[\s\S]*\? TRUE\s*:\s*FALSE;/,
  );
  assert.match(
    layout,
    /controller->put_IsVisible\(playbackControllerVisible\)/,
  );
  assert.match(
    layout,
    /authController->put_IsVisible\(TRUE\)/,
  );
});

test('Stationhead track-boundary observer remains available without hiding playback', () => {
  const boundary = section(
    stationheadBoundary,
    'inline std::wstring StationheadTrackBoundaryScript(',
    '}  // namespace hp',
  );
  assert.match(boundary, /const hideDelayMs = 5000;/);
  assert.match(boundary, /const revealBeforeEndSeconds = 10;/);
  assert.match(boundary, /Number\.isFinite\(duration\)/);
  assert.match(boundary, /'timeupdate'/);
  assert.match(boundary, /post\('track-boundary-retry'\)/);
  assert.match(boundary, /post\('track-ended'\)/);
  assert.match(boundary, /event\.type === 'pause'/);
  assert.match(boundary, /event\.type === 'stalled'/);
});

test('Spotify trusted Play click never hides the controller', () => {
  const releasedAt = spotifyClick.indexOf('L"Input.dispatchMouseEvent", released.c_str()');
  assert.ok(releasedAt >= 0);
  assert.doesNotMatch(
    spotifyClick.slice(releasedAt),
    /put_IsVisible\(FALSE\)/,
  );
});

test('Spotify remains visible after the observer confirms playback', () => {
  const observer = section(
    spotifyRotation,
    'void SpotifyWebViews::ArmTimedEndObserver',
    '}  // namespace hp',
  );
  assert.match(observer, /SetSlotState\(\*target, SlotState::Playing\)/);
  assert.doesNotMatch(observer, /put_IsVisible\(FALSE\)/);
});

test('Spotify reasserts visible state when its next-track advance begins', () => {
  const advance = section(
    spotifyRotation,
    'void SpotifyWebViews::AdvanceTimedRotationSlot',
    'void SpotifyWebViews::ProbeDueTimedCompletions',
  );
  const showAt = advance.indexOf('slot.controller->put_IsVisible(TRUE)');
  const applyAt = advance.indexOf('ApplyTimedRotationTarget(slot)');
  assert.ok(showAt >= 0);
  assert.ok(applyAt > showAt);
  assert.doesNotMatch(advance, /put_IsVisible\(FALSE\)/);
});
