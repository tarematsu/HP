import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const readNative = relative => readFileSync(
  new URL(`../../native/src/${relative}`, import.meta.url), 'utf8');

const appHeader = readNative('app.h');
const app = readNative('app.cpp');
const schedule = readNative('power_saving_schedule.inc');
const stationheadAudio = readNative('sh_audio.cpp');

function section(source, start) {
  const startAt = source.indexOf(start);
  assert.notEqual(startAt, -1, `missing section: ${start}`);
  return source.slice(startAt);
}

test('Stationhead routing is fail-closed and every service selection is deterministic', () => {
  assert.match(appHeader, /bool stationheadAudioMuted_ = true/);

  const route = section(
    schedule,
    'void PowerSavingController::ApplyAudioMode(AudioMode mode) noexcept',
  );
  assert.match(route, /UiAction action = UiAction::StationheadAudioMute/);
  assert.match(route, /case AudioMode::Stationhead:[\s\S]*UiAction::StationheadAudioToggle/);
  assert.match(route, /case AudioMode::StationheadPeer1:[\s\S]*UiAction::StationheadPeer1Audio/);
  assert.match(route, /case AudioMode::StationheadPeer5:[\s\S]*UiAction::StationheadPeer5Audio/);
  assert.match(route, /case AudioMode::Muted:[\s\S]*UiAction::StationheadAudioMute/);

  const primaryCase = route.slice(
    route.indexOf('case AudioMode::Stationhead:'),
    route.indexOf('case AudioMode::StationheadPeer1:'),
  );
  const normalizeMuteAt = primaryCase.indexOf(
    'static_cast<WPARAM>(UiAction::StationheadAudioMute)',
  );
  const toggleAt = primaryCase.indexOf('action = UiAction::StationheadAudioToggle');
  assert.notEqual(normalizeMuteAt, -1);
  assert.notEqual(toggleAt, -1);
  assert.ok(normalizeMuteAt < toggleAt, 'primary Stationhead is normalized muted before toggle');

  assert.match(app, /const auto mutePeers = \[this\]\(int selectedPeer\)/);
  assert.match(app, /case UiAction::StationheadPeer1Audio:[\s\S]*case UiAction::StationheadPeer5Audio:[\s\S]*mutePeers\(selectedPeer\)/);
});

test('Stationhead repairs WebView2 mute drift instead of trusting cached state', () => {
  assert.match(stationheadAudio, /get_IsMuted\(&current\)/);
  assert.match(stationheadAudio, /put_IsMuted\(desired\)/);
  assert.match(stationheadAudio, /get_IsMuted\(&confirmed\)/);
  assert.match(stationheadAudio, /applied \? desiredValue : -1/);
  assert.doesNotMatch(
    stationheadAudio,
    /appliedMuted_\.load\([^\n]*\) == [^\n]*return/,
  );
});
