import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const app = readFileSync(new URL('../../native/src/app.cpp', import.meta.url), 'utf8');
const handles = readFileSync(
  new URL('../../native/src/app_stationhead_handles.h', import.meta.url), 'utf8');

function section(text, start, end) {
  const from = text.indexOf(start);
  assert.notEqual(from, -1, `missing section: ${start}`);
  const to = text.indexOf(end, from + start.length);
  assert.notEqual(to, -1, `missing section terminator: ${end}`);
  return text.slice(from, to);
}

function ordered(text, markers) {
  let previous = -1;
  for (const marker of markers) {
    const at = text.indexOf(marker);
    assert.ok(at > previous, `missing/out-of-order marker: ${marker}`);
    previous = at;
  }
}

test('dashboard initializes before the top-level window is exposed', () => {
  const start = section(app, 'void App::StartServices()', 'void App::StartDeferredServices(');
  ordered(start, [
    'renderer_->Initialize();',
    'rendererStarted_ = true;',
    'LayoutWorkspace();',
    'renderer_->TickNativePanels(startupAt_);',
    'stationhead_->Start();',
    'ShowWindow(window_, startupShowCommand_);',
  ]);
});

test('single Stationhead workspace keeps the dashboard visible', () => {
  const layout = section(app, 'void App::LayoutWorkspace()',
    'void App::ApplyStationheadWindowPlacement(');
  assert.match(layout, /selectedTab_ = WorkspaceTab::Main;/);
  assert.match(layout, /renderer_->SetVisible\(rendererStarted_\);/);
});

test('cold startup has exactly one Stationhead player', () => {
  const start = section(app, 'void App::StartServices()', 'void App::StartDeferredServices(');
  assert.match(start, /StationheadRole::Primary/);
  assert.match(start, /stationhead_->Start\(\)/);
  assert.doesNotMatch(start, /#if 0|StationheadRole::Secondary|secondaryStationhead_/);
  assert.doesNotMatch(handles, /AppSecondaryStationheadHandle|SecondaryStationheadStartupReady/);
});
