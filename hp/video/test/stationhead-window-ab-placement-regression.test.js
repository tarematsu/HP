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

test('Window A and B converge on the same foreground and background implementation', () => {
  const placement = section(
    appSource,
    'void App::ApplyStationheadWindowPlacement(',
    'void App::PublishRenderState()',
  );
  assert.match(placement, /stationhead_->SelectTab\(StationheadTabKind::None\);/);
  assert.match(placement, /secondaryStationhead_->RefreshVisibility\(\);/);

  const selectPlayerTab = section(
    handleSource,
    'void StationheadHandleBase::SelectPlayerTab(StationheadTabKind tab)',
    'bool StationheadHandleBase::IsInteractive(',
  );
  assert.match(
    selectPlayerTab,
    /if \(tab == StationheadTabKind::None\) \{[\s\S]*RefreshVisibility\(\);[\s\S]*return;/,
  );

  const refreshVisibility = section(
    handleSource,
    'void StationheadHandleBase::RefreshVisibility()',
    'void StationheadHandleBase::Start()',
  );
  assert.match(refreshVisibility, /player_->SelectTab\(StationheadTabKind::None\);/);
  assert.match(refreshVisibility, /ApplyBounds\(\);/);

  const tick = section(
    handleSource,
    'void StationheadHandleBase::Tick(int64_t nowMs)',
    'void StationheadHandleBase::Reconnect()',
  );
  assert.match(tick, /RaiseActiveHost\(\);/);

  const raiseActiveHost = section(
    handleSource,
    'void StationheadHandleBase::RaiseActiveHost() const',
    'void StationheadHandleBase::ApplyInteractiveBounds()',
  );
  assert.match(raiseActiveHost, /IsInteractive\(status\)/);
  assert.match(raiseActiveHost, /SetWindowPos\(host, HWND_TOP/);
  assert.match(raiseActiveHost, /BringMainWindowToFront\(host\);/);
});

test('normal playback stays behind while explicit auth surfaces may occupy the workspace', () => {
  const policy = section(
    layoutSource,
    'struct StationheadSurfacePolicy',
    'void ApplyStationheadChildLayout(',
  );
  assert.match(policy, /bool showAuth = false;/);
  assert.match(policy, /bool showPlayback = false;/);
  assert.match(policy, /bool hidePlayback = false;/);
  assert.match(
    policy,
    /return \{authSelected && authSurfaceReady, playbackSelected, authSelected\};/,
  );
  assert.match(policy, /StationheadTabKind::Stationhead, true\)\.showPlayback/);
  assert.match(policy, /StationheadTabKind::Auth, false\)\.hidePlayback/);
  assert.match(policy, /StationheadTabKind::None, false\)\.hidePlayback/);

  const layout = section(
    layoutSource,
    'void StationheadPlayer::LayoutControllers()',
    'void StationheadPlayer::SetBounds(',
  );
  assert.match(
    layout,
    /policy\.showAuth, policy\.showPlayback,[\s\S]*policy\.hidePlayback/,
  );
  assert.match(layout, /status_\.visible = policy\.showAuth \|\| policy\.showPlayback/);
  assert.doesNotMatch(layout, /showStartupPreview|contentVisible|previewVisible/);

  const setVisible = section(
    layoutSource,
    'void StationheadPlayer::SetVisible(bool visible)',
    'void StationheadPlayer::LayoutControllers()',
  );
  assert.match(
    setVisible,
    /selectedTab_ != StationheadTabKind::Auth &&[\s\S]*selectedTab_ != StationheadTabKind::Stationhead[\s\S]*KeepPlaybackBehindDashboard\(\)[\s\S]*return;/,
  );
  assert.match(
    setVisible,
    /PlaybackSurfaceMatches\([\s\S]*width, height, HWND_TOP\)[\s\S]*WindowContainsFocus\(hostWindow_\)[\s\S]*return;/,
  );
  assert.match(
    setVisible,
    /authController_ && authWebview_[\s\S]*ActiveAuthSurfaceMatches\([\s\S]*WindowContainsFocus\(authHostWindow_\)[\s\S]*return;/,
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
