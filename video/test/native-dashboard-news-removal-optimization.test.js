import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const dashboardParser = readFileSync(
  new URL('../../native/src/dashboard_data.cpp', import.meta.url),
  'utf8',
);
const dashboardDataHeader = readFileSync(
  new URL('../../native/src/dashboard_data.h', import.meta.url),
  'utf8',
);
const dashboardLoader = readFileSync(
  new URL('../../native/src/renderer_dashboard.cpp', import.meta.url),
  'utf8',
);
const panelState = readFileSync(
  new URL('../../native/src/renderer_panel_state.cpp', import.meta.url),
  'utf8',
);
const panelWindows = readFileSync(
  new URL('../../native/src/renderer_panels/windows.inc', import.meta.url),
  'utf8',
);
const dataSections = readFileSync(
  new URL('../../native/src/renderer_panels/data_sections.inc', import.meta.url),
  'utf8',
);
const layout = readFileSync(
  new URL('../../native/src/renderer_panels/layout_overrides.inc', import.meta.url),
  'utf8',
);

test('removed native News panel no longer parses or hashes News payloads', () => {
  assert.doesNotMatch(dashboardParser, /json::Object\(root, L"news"\)/);
  assert.doesNotMatch(dashboardParser, /newsItems\.reserve|next\.newsItems\.push_back/);
  assert.doesNotMatch(dashboardParser, /next\.revisions\.news/);
});

test('News data types and snapshot storage are removed', () => {
  assert.doesNotMatch(dashboardDataHeader, /NewsItemData/);
  assert.doesNotMatch(dashboardDataHeader, /newsItems|newsItemCount/);
  assert.doesNotMatch(dashboardDataHeader, /uint64_t news/);
});

test('dashboard loader does not publish News-only changes', () => {
  assert.match(dashboardLoader, /const bool contentChanged = weatherChanged \|\| energyChanged;/);
  assert.doesNotMatch(dashboardLoader, /dashboardRevisions_\.news/);
});

test('dashboard loader retains a compact signature instead of the full JSON copy', () => {
  assert.match(dashboardLoader, /compatibility field name/);
  assert.match(dashboardLoader, /const std::string contentSignature =/);
  assert.match(
    dashboardLoader,
    /std::to_string\(sourceSize\) \+ ":" \+ std::to_string\(Fnv1a64\(text\)\)/,
  );
  assert.match(dashboardLoader, /dashboardUtf8_ = contentSignature;/);
  assert.doesNotMatch(dashboardLoader, /dashboardUtf8_ = std::move\(text\)/);
});

test('native panel state no longer compares or invalidates News revisions', () => {
  assert.doesNotMatch(panelState, /newsIndexChanged|newsChanged|nativeNewsRenderRevision_/);
  assert.doesNotMatch(panelState, /PanelSection::News/);
});

test('News drawing function and paint branches are removed', () => {
  assert.doesNotMatch(dataSections, /DrawNewsSection|ニュース取得待ち/);
  assert.doesNotMatch(panelWindows, /PanelSection::News|sections\.news|nativeNewsRenderRevision_/);
  assert.doesNotMatch(layout, /sections\.news/);
});

test('playback projection runs only while the main panel is visible', () => {
  assert.match(
    panelState,
    /if \(nativeMainWindow_ && IsWindow\(nativeMainWindow_\) &&\s*IsWindowVisible\(nativeMainWindow_\)\) \{\s*const NativePlaybackTickState playbackState = NativePlaybackTickStateFor\(nowMs\);/s,
  );
});
