import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const layoutSource = readFileSync(
  new URL('../../native/src/sh_layout.cpp', import.meta.url),
  'utf8',
);
const playerHeader = readFileSync(
  new URL('../../native/src/sh.h', import.meta.url),
  'utf8',
);
const handleSource = readFileSync(
  new URL('../../native/src/app_stationhead_handles.cpp', import.meta.url),
  'utf8',
);

function section(source, start, end) {
  const startAt = source.indexOf(start);
  assert.notEqual(startAt, -1, `missing section: ${start}`);
  const endAt = source.indexOf(end, startAt + start.length);
  assert.notEqual(endAt, -1, `missing section terminator: ${end}`);
  return source.slice(startAt, endAt);
}

test('single Stationhead configuration expands the primary surface to the full parent client', () => {
  assert.match(
    layoutSource,
    /ConfiguresSecondaryStationheadWindow\(const StationheadConfig& config\)[\s\S]*config\.secondaryEnabled && !config\.secondaryUrl\.empty\(\)/,
  );
  assert.match(
    layoutSource,
    /ResolveStationheadWorkspaceBounds\([\s\S]*role == StationheadRole::Secondary[\s\S]*ConfiguresSecondaryStationheadWindow\(config\)[\s\S]*GetClientRect\(parent, &client\)/,
  );
  assert.match(
    layoutSource,
    /void StationheadPlayer::SetBounds\(const RECT& bounds\)[\s\S]*ResolveStationheadWorkspaceBounds\(role_, config_, window_, bounds\)/,
  );
});

test('hidden playback placement does not trust a stale cached visible flag', () => {
  const keepBehind = section(
    layoutSource,
    'void StationheadPlayer::KeepPlaybackBehindDashboard()',
    'void StationheadPlayer::SetStartupBounds()',
  );
  assert.doesNotMatch(
    keepBehind,
    /if \(!viewVisible_ && selectedTab_ == StationheadTabKind::None\)[\s\S]*status_\.visible/,
  );
  assert.match(keepBehind, /ApplyStationheadChildLayout\([\s\S]*bounds_, false, false, false\)/);
});

test('child hosts are resized before WebView controller bounds are applied', () => {
  const applyLayout = section(
    layoutSource,
    'void ApplyStationheadChildLayout(',
    '\n}\n\n}\n\nbool StationheadPlayer::EnsureHostWindow()',
  );
  const hostPlacement = applyLayout.indexOf('SetWindowPos(hostWindow');
  const controllerPlacement = applyLayout.indexOf('if (controller)');
  const authHostPlacement = applyLayout.indexOf('SetWindowPos(authHostWindow');
  const authControllerPlacement = applyLayout.indexOf('if (authController)');
  assert.ok(hostPlacement >= 0 && hostPlacement < controllerPlacement);
  assert.ok(authHostPlacement >= 0 && authHostPlacement < authControllerPlacement);
});

test('failed host creation clears the public visible state', () => {
  const layoutControllers = section(
    layoutSource,
    'void StationheadPlayer::LayoutControllers()',
    'void StationheadPlayer::SetBounds(',
  );
  assert.match(
    layoutControllers,
    /if \(!EnsureHostWindow\(\)\)[\s\S]*status_\.visible = false;[\s\S]*return;/,
  );
});

test('scheduled WebView recreation is not reported as healthy playback', () => {
  const audioPlaying = section(
    playerHeader,
    '[[nodiscard]] bool AudioPlaying() const noexcept',
    '[[nodiscard]] int64_t AudioPlayingSince() const noexcept',
  );
  assert.match(audioPlaying, /!recreating_\.load\(std::memory_order_relaxed\)/);
  assert.match(audioPlaying, /audioPlaying_\.load\(std::memory_order_relaxed\)/);
  assert.match(
    playerHeader,
    /AudioPlayingSince\(\) const noexcept[\s\S]*return AudioPlaying\(\)[\s\S]*: 0;/,
  );
  assert.match(
    layoutSource,
    /bool StationheadPlayer::NeedsInteractiveWindow\(\) const[\s\S]*controller_ && !AudioPlaying\(\)/,
  );
});

test('handle status and placement use the recreation-aware audio state', () => {
  const rawStatus = section(
    handleSource,
    'StationheadStatus StationheadHandleBase::RawStatus() const',
    'StationheadStatus StationheadHandleBase::Status() const',
  );
  assert.match(rawStatus, /player_->AudioPlaying\(\)/);
  assert.match(rawStatus, /status\.audioPlaying = audioPlaying;/);
  assert.match(rawStatus, /status\.playing = audioPlaying;/);

  const refreshVisibility = section(
    handleSource,
    'void StationheadHandleBase::RefreshVisibility()',
    'void StationheadHandleBase::Start()',
  );
  assert.match(refreshVisibility, /const StationheadStatus status = RawStatus\(\);/);

  const raiseActiveHost = section(
    handleSource,
    'void StationheadHandleBase::RaiseActiveHost() const',
    'void StationheadHandleBase::ApplyInteractiveBounds()',
  );
  assert.match(raiseActiveHost, /const StationheadStatus status = RawStatus\(\);/);
});

test('handle raises the active host without overwriting player-owned geometry', () => {
  const raiseActiveHost = section(
    handleSource,
    'void StationheadHandleBase::RaiseActiveHost() const',
    'void StationheadHandleBase::ApplyInteractiveBounds()',
  );
  assert.match(raiseActiveHost, /SetWindowPos\(host, HWND_TOP, 0, 0, 0, 0,/);
  assert.match(raiseActiveHost, /SWP_NOMOVE \| SWP_NOSIZE/);
  assert.doesNotMatch(raiseActiveHost, /const RECT activeBounds/);
  assert.doesNotMatch(raiseActiveHost, /workspaceBounds_\.right - workspaceBounds_\.left/);
});
