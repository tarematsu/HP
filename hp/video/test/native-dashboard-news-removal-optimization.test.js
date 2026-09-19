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
const nativePlayback = readFileSync(
  new URL('../../native/src/dashboard_native_playback.cpp', import.meta.url),
  'utf8',
);
const playbackResolve = readFileSync(
  new URL('../../native/src/dashboard_playback_resolve.cpp', import.meta.url),
  'utf8',
);
const artworkCache = readFileSync(
  new URL('../../native/src/artwork_cache.h', import.meta.url),
  'utf8',
);
const airHistory = readFileSync(
  new URL('../../native/src/app_air_history.cpp', import.meta.url),
  'utf8',
);
const stationheadHandles = readFileSync(
  new URL('../../native/src/app_stationhead_handles.cpp', import.meta.url),
  'utf8',
);
const stationheadPlayerHeader = readFileSync(
  new URL('../../native/src/sh.h', import.meta.url),
  'utf8',
);
const sensorSerial = readFileSync(
  new URL('../../native/src/sensors_serial.cpp', import.meta.url),
  'utf8',
);
const loggerHeader = readFileSync(
  new URL('../../native/src/logger.h', import.meta.url),
  'utf8',
);
const loggerSource = readFileSync(
  new URL('../../native/src/logger.cpp', import.meta.url),
  'utf8',
);
const radarUi = readFileSync(
  new URL('../../native/src/renderer_radar_ui.cpp', import.meta.url),
  'utf8',
);
const bitmapCache = readFileSync(
  new URL('../../native/src/renderer_bitmap_cache.cpp', import.meta.url),
  'utf8',
);
const rendererHeader = readFileSync(
  new URL('../../native/src/web_renderer.h', import.meta.url),
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

test('Renderer retains no News enum, drawing declaration, or state member', () => {
  assert.doesNotMatch(rendererHeader, /PanelSection::News|\bNews\s*[,}]/);
  assert.doesNotMatch(rendererHeader, /DrawNewsSection/);
  assert.doesNotMatch(rendererHeader, /nativeNewsIndex_|nativeNewsRenderRevision_|newsCount_/);
});

test('dashboard loader does not publish News-only changes', () => {
  assert.match(dashboardLoader, /const bool contentChanged = weatherChanged \|\| energyChanged;/);
  assert.doesNotMatch(dashboardLoader, /dashboardRevisions_\.news|newsCount_/);
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

test('native playback state retains only a compact queue signature', () => {
  const updateStruct = rendererHeader.match(
    /struct NativePlaybackUpdate \{([\s\S]*?)\n  \};/,
  )?.[1] ?? '';
  assert.doesNotMatch(updateStruct, /std::wstring|fetchedAt/);
  assert.doesNotMatch(rendererHeader, /nativePlaybackRevision_/);
  assert.match(nativePlayback, /uint64_t PlaybackSnapshotSignature\(/);
  assert.match(nativePlayback, /update\.payloadSignature = projectionSignature;/);
  assert.doesNotMatch(nativePlayback, /PayloadSignature\(payload\)/);
  assert.doesNotMatch(nativePlayback, /update\.payload\s*=/);
  assert.doesNotMatch(nativePlayback, /update\.(?:source|error|fetchedAt)\s*=/);
});

test('playback snapshots persist only compact playback and minute facts', () => {
  assert.match(nativePlayback, /kCompactSnapshotVersion = 2;/);
  assert.match(nativePlayback, /bool SaveDashboardSnapshot\([\s\S]*const NativePlaybackProjection& playback[\s\S]*const NativeMinuteFactsProjection& facts/s);
  assert.match(nativePlayback, /L",\\"playback\\":\{"/);
  assert.match(nativePlayback, /L"\]\},\\"facts\\":\{"/);
  assert.match(nativePlayback, /bool LoadCompactSnapshot\(/);
  assert.match(nativePlayback, /Read snapshots created by pre-v2 builds once/);
  const saveFunction = nativePlayback.match(
    /bool SaveDashboardSnapshot\([\s\S]*?\n\}/,
  )?.[0] ?? '';
  assert.doesNotMatch(saveFunction, /payload/);
});

test('playback snapshot writes use queue persistence changes or 30 minute checkpoints', () => {
  assert.match(nativePlayback, /kDashboardSnapshotCheckpointMs = 30 \* 60'000;/);
  assert.match(nativePlayback, /uint64_t PlaybackPersistenceSignature\(/);
  assert.match(nativePlayback, /const bool snapshotChanged =\s*persistenceSignature != lastPersistenceSignature;/s);
  assert.match(nativePlayback, /fetchedAt - lastSnapshotSavedAt >= kDashboardSnapshotCheckpointMs/);
  assert.match(nativePlayback, /\(snapshotChanged \|\| checkpointDue\) &&\s*SaveDashboardSnapshot/s);
});

test('dashboard response JSON is parsed once for playback and status', () => {
  assert.match(nativePlayback, /bool ParseDashboardPayload\(/);
  assert.match(nativePlayback, /facts = ParseDashboardStatus\(root, fetchedAt\)/);
  const fetchFunction = nativePlayback.match(
    /std::wstring FetchDashboardJson\([\s\S]*?\n\}/,
  )?.[0] ?? '';
  assert.doesNotMatch(fetchFunction, /JsonObject::Parse|JsonValue::Parse/);
  assert.match(nativePlayback, /ParseDashboardPayload\(\s*dataDir_, payload, fetchedAt, &projection, &statusProjection, &error\)/s);
});

test('playback polling does not invalidate the unrelated radar panel', () => {
  assert.doesNotMatch(nativePlayback, /PanelSection::Radar|PanelSection::Music/);
});

test('playback update storage is reduced to one native source', () => {
  assert.match(rendererHeader, /NativePlaybackUpdate nativePlaybackUpdate_\{\};/);
  assert.doesNotMatch(rendererHeader, /nativePlaybackUpdates_|std::array<NativePlaybackUpdate/);
  assert.match(nativePlayback, /NativePlaybackUpdate& update = nativePlaybackUpdate_;/);
  assert.match(playbackResolve, /const NativePlaybackUpdate& update = nativePlaybackUpdate_;/);
  assert.doesNotMatch(nativePlayback, /nativePlaybackUpdates_/);
  assert.doesNotMatch(playbackResolve, /nativePlaybackUpdates_/);
});

test('unused artwork pipeline performs no native caching or download', () => {
  assert.match(artworkCache, /inline std::wstring CacheArtworkUrl/);
  assert.match(artworkCache, /return \{\};/);
  assert.doesNotMatch(
    artworkCache,
    /MemoryIndex|WinHttpDownload|spotify-artwork-cache|NetworkRequestCoordinator/,
  );
  assert.doesNotMatch(rendererHeader, /NativeArtworkBitmap/);
  assert.doesNotMatch(bitmapCache, /NativeArtworkBitmap/);
});

test('air history display remains five minute data while persistence is batched', () => {
  assert.match(airHistory, /kAirHistoryBucketMs = 5LL \* 60 \* 1000;/);
  assert.match(airHistory, /kAirHistoryPersistIntervalMs = 30LL \* 60 \* 1000;/);
  assert.match(
    airHistory,
    /now - lastAirHistorySavedAt_ >= kAirHistoryPersistIntervalMs[\s\S]*SaveAirHistory\(\)/,
  );
  assert.doesNotMatch(
    airHistory,
    /\+\+renderState_\.airHistoryRevision;\s*SaveAirHistory\(\);\s*MarkRenderStateDirty\(\);/s,
  );
});

test('steady Stationhead ticks read only the authorization flag', () => {
  assert.match(stationheadPlayerHeader, /bool SpotifyAuthorizationActive\(\) const/);
  assert.match(stationheadHandles, /player_->SpotifyAuthorizationActive\(\)/);
  assert.doesNotMatch(stationheadHandles, /player_->Status\(\)\.spotifyAuthorization/);
});

test('missing serial sensors use bounded exponential retry backoff', () => {
  assert.match(sensorSerial, /kSerialRetryInitial = std::chrono::seconds\(10\)/);
  assert.match(sensorSerial, /kSerialRetryMaximum = std::chrono::seconds\(60\)/);
  assert.match(sensorSerial, /const auto waitForRetry/);
  assert.match(sensorSerial, /retryDelay = std::min\(retryDelay \* 2, kSerialRetryMaximum\)/);
  assert.match(sensorSerial, /if \(changed\) PostMessageW\(window_, WM_HP_SENSOR_UPDATED/);
  assert.doesNotMatch(sensorSerial, /wait_for\(lock, std::chrono::seconds\(10\)/);
});

test('logger keeps one stream open and avoids filesystem metadata checks per line', () => {
  assert.match(loggerHeader, /std::ofstream output_;/);
  assert.match(loggerHeader, /size_t currentBytes_ = 0;/);
  assert.match(loggerSource, /kLogFlushThresholdBytes = 64 \* 1024;/);
  assert.match(loggerSource, /output_\.write\(/);
  assert.doesNotMatch(loggerSource, /RotateIfNeeded/);
  const writeFunction = loggerSource.match(
    /void Logger::Write\([\s\S]*?\n\}/,
  )?.[0] ?? '';
  assert.doesNotMatch(writeFunction, /fs::exists|fs::file_size|std::ofstream output\(/);
});

test('single radar waits only for cloud update notifications', () => {
  assert.match(radarUi, /radarComposeWake_\.wait\(waitLock/);
  assert.match(radarUi, /radarComposePending_/);
  assert.doesNotMatch(radarUi, /wait_for\s*\(/);
  assert.doesNotMatch(radarUi, /frameIntervalMs|animationIntervalMs|selectedIndex/);
});

test('single radar performs no local frame snapshot serialization', () => {
  assert.match(radarUi, /DecodeImageFileToBitmap/);
  assert.match(radarUi, /radarFrameBitmap_ = decoded/);
  assert.doesNotMatch(radarUi, /SaveBitmapAsBmp|radar-frame\.bmp|radar-frame\.signature/);
});

test('radar updates invalidate only the relocated radar section', () => {
  assert.match(radarUi, /InvalidatePanelSection\(nativeMainWindow_, PanelSection::Radar\);/);
  assert.doesNotMatch(radarUi, /InvalidateRadarWindow\(nativeRadarWindow_\);/);
  assert.doesNotMatch(radarUi, /InvalidateAllNativePanels\(\)/);
  assert.doesNotMatch(radarUi, /CachedRadarSourceDc|BlendBitmap|CreateCompatibleDC/);
});

test('native bitmap caching keeps only weather icons plus the single radar frame', () => {
  assert.match(bitmapCache, /kWeatherIconBitmapCacheLimit = 12;/);
  assert.doesNotMatch(
    bitmapCache,
    /kNativeImageBitmapCacheLimit|kRadarBitmapCacheLimit|CachedRadarBitmap/,
  );
  assert.doesNotMatch(
    rendererHeader,
    /nativeRadarBitmaps_|nativeRadarBitmapUseCounter_|CachedRadarBitmap/,
  );
  assert.match(rendererHeader, /HBITMAP radarFrameBitmap_ = nullptr;/);
});

test('native panels share one retained backing bitmap', () => {
  assert.match(bitmapCache, /nativeBackBuffers_\[nullptr\]/);
  assert.match(bitmapCache, /buffer\.width >= width && buffer\.height >= height/);
  assert.doesNotMatch(bitmapCache, /nativeBackBuffers_\[hwnd\]/);
});

test('clock second ticks redraw only the time while footer refreshes by minute', () => {
  assert.match(panelState, /const bool clockMinuteChanged = previousClockSecondKey < 0 \|\|/);
  assert.match(panelState, /clockDayChanged \|\| clockMinuteChanged[\s\S]*PanelSection::Clock[\s\S]*PanelSection::ClockTime/s);
  assert.match(
    layout,
    /RECT timeRect\{content\.left, content\.top \+ SpanY\(content, 170\),\s*content\.right, content\.top \+ SpanY\(content, 650\)\}/s,
  );
  assert.doesNotMatch(layout, /Include the footer in the clock tick invalidation/);
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

test('playback projection does not repaint or retain a native media display model', () => {
  assert.doesNotMatch(panelState, /NativePlaybackTickStateFor\(nowMs\)/);
  assert.doesNotMatch(panelState, /PanelSection::PlaybackProgress/);
  assert.doesNotMatch(rendererHeader, /NativePlaybackRender|ResolveNativePlayback/);
  assert.doesNotMatch(playbackResolve, /Renderer::ResolveNativePlayback/);
});
