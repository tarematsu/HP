import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const cmakeSource = readFileSync(
  new URL('../../native/CMakeLists.txt', import.meta.url),
  'utf8',
);
const appSource = readFileSync(
  new URL('../../native/src/app.cpp', import.meta.url),
  'utf8',
);
const disabledStubs = readFileSync(
  new URL('../../native/src/stationhead_disabled_stubs.cpp', import.meta.url),
  'utf8',
);

function section(source, start, end) {
  const startAt = source.indexOf(start);
  assert.notEqual(startAt, -1, `missing section: ${start}`);
  const endAt = source.indexOf(end, startAt + start.length);
  assert.notEqual(endAt, -1, `missing section terminator: ${end}`);
  return source.slice(startAt, endAt);
}

test('Stationhead implementation is not compiled into HomePanel', () => {
  const stationheadSources = section(
    cmakeSource,
    'set(HOMEPANEL_STATIONHEAD_SOURCES',
    'set(HOMEPANEL_RENDERER_SOURCES',
  );
  for (const source of [
    'src/sh.cpp',
    'src/sh_webview.cpp',
    'src/sh_layout.cpp',
    'src/sh_audio.cpp',
    'src/sh_audio_loss.cpp',
    'src/stationhead_native_stats.cpp',
  ]) {
    assert.match(stationheadSources, new RegExp(`# ${source.replaceAll('.', '\\.')}`));
    assert.doesNotMatch(stationheadSources, new RegExp(`^\\s{2}${source.replaceAll('.', '\\.')}`, 'm'));
  }
  assert.match(cmakeSource, /src\/stationhead_disabled_stubs\.cpp/);
  assert.match(cmakeSource, /src\/shared_webview_environment\.cpp/);
});

test('Stationhead player construction and start remain compile-disabled', () => {
  const startServices = section(
    appSource,
    'void App::StartServices()',
    'void App::ApplyStartupStationheadPreview()',
  );
  assert.match(
    startServices,
    /#if 0\s+\/\/ Stationhead disabled:[\s\S]*std::make_unique<StationheadPlayer>/,
  );
  assert.match(
    startServices,
    /#if 0\s+\/\/ Stationhead disabled\.[\s\S]*stationhead_->Start\(\)/,
  );
});

test('disabled compatibility layer cannot create Stationhead surfaces', () => {
  assert.doesNotMatch(disabledStubs, /CreateWindow|CreateCoreWebView2|Navigate\(|SetWindowPos|ShowWindow/);
  assert.match(disabledStubs, /StationheadPlayer::~StationheadPlayer\(\) = default/);
  assert.match(disabledStubs, /GetStationheadNativeStatsRevision\(\)[\s\S]*return 0/);
});
