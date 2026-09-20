import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = name => readFileSync(new URL(`../../native/src/${name}`, import.meta.url), 'utf8');
const app = source('app.cpp');
const layout = source('sh_layout.cpp');
const handles = source('app_stationhead_handles.h');
const playerHeader = source('sh.h');

function section(text, start, end) {
  const from = text.indexOf(start);
  assert.notEqual(from, -1, `missing section: ${start}`);
  const to = text.indexOf(end, from + start.length);
  assert.notEqual(to, -1, `missing section terminator: ${end}`);
  return text.slice(from, to);
}

test('all Stationhead instances start without independent foreground permission', () => {
  const start = section(app, 'void App::StartServices()', 'void App::StartDeferredServices(');
  assert.match(start, /stationheadPeers_\[i\]->SetForegroundAllowed\(false\)/);
  assert.match(start, /stationhead_->SetForegroundAllowed\(false\)/);
  assert.match(handles, /void SetForegroundAllowed\(bool allowed\)[\s\S]*player_->SetForegroundAllowed\(allowed\)/);
});

test('only an explicit Stationhead interactive surface enters foreground arbitration', () => {
  assert.match(
    playerHeader,
    /bool ForegroundRequested\(\) const noexcept \{[\s\S]*selectedTab_ == StationheadTabKind::Auth[\s\S]*selectedTab_ == StationheadTabKind::Stationhead/,
  );
  assert.match(
    handles,
    /bool ForegroundRequested\(\) const noexcept \{[\s\S]*player_->ForegroundRequested\(\)/,
  );

  const tick = section(app, 'void App::Tick()', 'void App::Draw()');
  const arbitration = section(
    tick,
    'int foregroundOwner = -1;',
    'ApplyStationheadWindowPlacement();',
  );
  assert.match(arbitration, /stationheadPeers_\[i\]->ForegroundRequested\(\)/);
  assert.match(arbitration, /stationhead_->ForegroundRequested\(\)/);
  assert.doesNotMatch(arbitration, /StationheadNeedsForeground|audioPlaying/);
});

test('lowest numbered Stationhead request is the only foreground owner', () => {
  const tick = section(app, 'void App::Tick()', 'void App::Draw()');
  const peerScan = tick.indexOf('if (stationheadPeers_[i]->ForegroundRequested())');
  const peerWinner = tick.indexOf('foregroundOwner = static_cast<int>(i);', peerScan);
  const sixthFallback = tick.indexOf('foregroundOwner = static_cast<int>(kStationheadPeerCount);', peerWinner);
  assert.ok(peerScan >= 0 && peerWinner > peerScan && sixthFallback > peerWinner);
  assert.match(tick, /if \(stationheadPeers_\[i\]->ForegroundRequested\(\)\) \{[\s\S]*break;/);

  const revoke = tick.indexOf('SetForegroundAllowed(false);', sixthFallback);
  const grant = tick.indexOf('SetForegroundAllowed(true);', revoke);
  assert.ok(revoke > sixthFallback && grant > revoke, 'losers must be revoked before the winner is granted');
});

test('non-owner auth and recovery surfaces remain backgrounded and cannot steal focus', () => {
  const controllers = section(layout,
    'void StationheadPlayer::LayoutControllers()',
    'void StationheadPlayer::SetBounds(');
  assert.match(controllers, /foregroundAllowed_ \|\| monitorForeground/);
  assert.match(controllers, /showAuth = foregroundGranted && policy\.showAuth/);
  assert.match(controllers, /showPlayback = foregroundGranted && policy\.showPlayback/);

  const activeHost = section(layout,
    'HWND StationheadPlayer::ActiveHostWindowForAccountSetup() const noexcept',
    '}  // namespace hp');
  assert.match(activeHost, /!foregroundAllowed_ && !StationheadMonitorForegroundForProfile\(profileName_\)/);
  assert.match(activeHost, /return nullptr/);

  const visible = section(layout,
    'void StationheadPlayer::SetVisible(bool visible)',
    'void StationheadPlayer::LayoutControllers()');
  assert.match(visible, /if \(!foregroundGranted\) return;/);
});
