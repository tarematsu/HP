import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const layoutSource = readFileSync(
  new URL('../../native/src/sh_layout.cpp', import.meta.url),
  'utf8',
);

function section(start, end) {
  const startAt = layoutSource.indexOf(start);
  assert.notEqual(startAt, -1, `missing section: ${start}`);
  const endAt = layoutSource.indexOf(end, startAt + start.length);
  assert.notEqual(endAt, -1, `missing section terminator: ${end}`);
  return layoutSource.slice(startAt, endAt);
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
    'void StationheadPlayer::LayoutControllers()',
    'void StationheadPlayer::SetBounds(',
  );
  assert.match(
    layoutControllers,
    /if \(!EnsureHostWindow\(\)\)[\s\S]*status_\.visible = false;[\s\S]*return;/,
  );
});
