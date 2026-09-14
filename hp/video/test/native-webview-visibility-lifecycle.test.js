import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = name => readFileSync(
  new URL(`../../native/src/${name}`, import.meta.url), 'utf8');

const stationhead = source('sh.cpp');
const stationheadPopup = source('sh_webview.cpp');
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

test('Spotify trusted Play click does not hide before playback confirmation', () => {
  const releasedAt = spotifyClick.indexOf('L"Input.dispatchMouseEvent", released.c_str()');
  assert.ok(releasedAt >= 0);
  assert.doesNotMatch(
    spotifyClick.slice(releasedAt),
    /controller->put_IsVisible\(FALSE\)/,
  );
});

test('Spotify hides only after the observer confirms started or resumed playback', () => {
  const observer = section(
    spotifyRotation,
    'void SpotifyWebViews::ArmTimedEndObserver',
    '}  // namespace hp',
  );
  const startedAt = observer.indexOf('const bool started = ParseSpotifyStartedEvent');
  const playingAt = observer.indexOf('SetSlotState(*target, SlotState::Playing)');
  const hideAt = observer.indexOf('target->controller->put_IsVisible(FALSE)');
  assert.ok(startedAt >= 0);
  assert.ok(playingAt > startedAt);
  assert.ok(hideAt > playingAt);
});

test('Spotify restores that slot when its next-track advance begins', () => {
  const advance = section(
    spotifyRotation,
    'void SpotifyWebViews::AdvanceTimedRotationSlot',
    'void SpotifyWebViews::ProbeDueTimedCompletions',
  );
  const showAt = advance.indexOf('slot.controller->put_IsVisible(TRUE)');
  const applyAt = advance.indexOf('ApplyTimedRotationTarget(slot)');
  assert.ok(showAt >= 0);
  assert.ok(applyAt > showAt);
});
