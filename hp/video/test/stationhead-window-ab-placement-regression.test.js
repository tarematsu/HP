import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const handleHeader = readFileSync(
  new URL('../../native/src/app_stationhead_handles.h', import.meta.url),
  'utf8',
);
const handleSource = readFileSync(
  new URL('../../native/src/app_stationhead_handles.cpp', import.meta.url),
  'utf8',
);
const appSource = readFileSync(
  new URL('../../native/src/app.cpp', import.meta.url),
  'utf8',
);
const layoutSource = readFileSync(
  new URL('../../native/src/sh_layout.cpp', import.meta.url),
  'utf8',
);

function section(source, start, end) {
  const startAt = source.indexOf(start);
  assert.notEqual(startAt, -1, `missing section: ${start}`);
  const endAt = source.indexOf(end, startAt + start.length);
  assert.notEqual(endAt, -1, `missing section terminator: ${end}`);
  return source.slice(startAt, endAt);
}

test('Window A and B publish interactive states as pending placement', () => {
  for (const [start, end] of [
    ['class AppStationheadHandle final', 'class AppSecondaryStationheadHandle final'],
    ['class AppSecondaryStationheadHandle final', '}  // namespace hp'],
  ]) {
    const handle = section(handleHeader, start, end);
    assert.match(handle, /StationheadStatus Status\(\) const/);
    assert.match(
      handle,
      /status\.loginRequired \|\| status\.spotifyAuthorization \|\| status\.processFailed/,
    );
    assert.match(handle, /status\.audioPlaying = false;/);
    assert.match(handle, /status\.playing = false;/);
  }
});

test('dual-window placement constrains pending A left and pending B right', () => {
  const placement = section(
    appSource,
    'void App::ApplyStationheadWindowPlacement(',
    'void App::PublishRenderState()',
  );
  assert.match(placement, /primaryPending = !primaryStatus\.audioPlaying;/);
  assert.match(placement, /secondaryPending = secondaryStationhead_ && !secondaryStatus\.playing;/);
  assert.match(placement, /stationhead_->SetBounds\(primaryPending \? left : bounds\);/);
  assert.match(
    placement,
    /secondaryStationhead_->SetBounds\(secondaryPending \? right : bounds\);/,
  );
});

test('pending Spotify auth hides the playback controller in both windows', () => {
  const policy = section(
    layoutSource,
    'struct StationheadSurfacePolicy',
    'void ApplyStationheadChildLayout(',
  );
  assert.match(policy, /bool hidePlaybackForPendingAuth = false;/);
  assert.match(
    policy,
    /hidePlaybackForPendingAuth = authSelected && !authSurfaceReady/,
  );
  assert.match(
    policy,
    /startupPreviewActive && !showAuth && !hidePlaybackForPendingAuth/,
  );
  assert.match(
    policy,
    /StationheadTabKind::Auth, false\)\.hidePlaybackForPendingAuth/,
  );

  const layout = section(
    layoutSource,
    'void StationheadPlayer::LayoutControllers()',
    'void StationheadPlayer::SetBounds(',
  );
  assert.match(
    layout,
    /contentVisible = viewVisible_ && !policy\.hidePlaybackForPendingAuth/,
  );
  assert.match(
    layout,
    /status_\.visible = policy\.showStartupPreview \|\| policy\.showAuth \|\| contentVisible/,
  );

  const setVisible = section(
    layoutSource,
    'void StationheadPlayer::SetVisible(bool visible)',
    'void StationheadPlayer::LayoutControllers()',
  );
  assert.match(
    setVisible,
    /if \(selectedTab_ == StationheadTabKind::Auth\)[\s\S]*activeController = authController_\.Get\(\);[\s\S]*activeHost = authHostWindow_;[\s\S]*if \(activeController && activeHost/,
  );
});

test('unmuting either window mutes its peer first', () => {
  assert.match(handleHeader, /AppStationheadHandle\(\);/);
  assert.match(handleHeader, /~AppStationheadHandle\(\);/);
  assert.match(handleHeader, /AppSecondaryStationheadHandle\(\);/);
  assert.match(handleHeader, /~AppSecondaryStationheadHandle\(\);/);
  assert.match(handleSource, /StationheadHandleBase\* primaryAudioHandle = nullptr;/);
  assert.match(handleSource, /StationheadHandleBase\* secondaryAudioHandle = nullptr;/);

  const setMuted = section(
    handleSource,
    'void StationheadHandleBase::SetAudioMuted(bool muted) noexcept',
    'void StationheadHandleBase::SetBounds(',
  );
  const peerMuteAt = setMuted.indexOf('peer->SetAudioMuted(true);');
  const unchangedAt = setMuted.indexOf('if (audioMuted_ == muted) return;');
  const applyAt = setMuted.indexOf('player_->SetMuted(muted);');
  assert.ok(peerMuteAt >= 0 && peerMuteAt < unchangedAt);
  assert.ok(unchangedAt >= 0 && unchangedAt < applyAt);
  assert.match(setMuted, /if \(!muted\)/);
  assert.match(setMuted, /PeerAudioHandle\(this\)/);
});
