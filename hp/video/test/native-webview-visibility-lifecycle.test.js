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

test('Stationhead playback rendering suppression remains disabled', () => {
  assert.doesNotMatch(stationheadVisibility, /SetStationheadPlaybackRenderingSuppressed/);
  assert.match(
    stationheadVisibility,
    /StationheadPlaybackRenderingSuppressed\([\s\S]*?\) noexcept \{\s*return false;\s*\}/,
  );
});

test('Stationhead layout keeps playback alive while interactive auth overlays the media panel', () => {
  const layout = section(
    stationheadLayout,
    'void ApplyStationheadChildLayout(',
    '}  // namespace',
  );
  assert.match(layout, /const RECT surfaceBounds = StationheadBackgroundBounds\(workspaceBounds\)/);
  assert.match(layout, /const RECT monitorPanelBounds = StationheadMonitorPanelBounds\(workspaceBounds\)/);
  assert.match(layout, /playbackHostBounds = surfaceBounds/);
  assert.match(layout, /authHostBounds = showAuth \? monitorPanelBounds : surfaceBounds/);
  assert.doesNotMatch(layout, /StationheadOffscreenBounds|authOffscreen/);
  assert.match(layout, /controller->put_IsVisible\(TRUE\)/);
  assert.match(layout, /authController->put_IsVisible\(TRUE\)/);
  assert.doesNotMatch(layout, /put_IsVisible\(FALSE\)/);
});

test('obsolete Stationhead page-side track-boundary observer is a no-op', () => {
  const boundary = section(
    stationheadBoundary,
    'inline std::wstring StationheadTrackBoundaryScript(',
    '}  // namespace hp',
  );
  assert.match(boundary, /return L"void 0;"/);
  assert.doesNotMatch(boundary, /timeupdate|setInterval|MutationObserver/);
  assert.doesNotMatch(boundary, /track-boundary-retry|track-ended/);
});

test('Spotify trusted Play click never hides the controller', () => {
  const releasedAt = spotifyClick.indexOf('L"Input.dispatchMouseEvent", released.c_str()');
  assert.ok(releasedAt >= 0);
  assert.doesNotMatch(spotifyClick.slice(releasedAt), /put_IsVisible\(FALSE\)/);
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
