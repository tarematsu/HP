import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = name => readFileSync(
  new URL(`../../native/src/${name}`, import.meta.url),
  'utf8',
);
const cmakeSource = readFileSync(
  new URL('../../native/CMakeLists.txt', import.meta.url),
  'utf8',
);
const appSource = source('app.cpp');
const messages = source('app_messages.cpp');
const sharedEnvironment = source('shared_webview_environment.h');
const stationheadHeader = source('sh.h');

function section(sourceText, start, end) {
  const startAt = sourceText.indexOf(start);
  assert.notEqual(startAt, -1, `missing section: ${start}`);
  const endAt = sourceText.indexOf(end, startAt + start.length);
  assert.notEqual(endAt, -1, `missing section terminator: ${end}`);
  return sourceText.slice(startAt, endAt);
}

test('Stationhead implementation is compiled without profile-reuse shim headers', () => {
  const stationheadSources = section(
    cmakeSource,
    'set(HOMEPANEL_STATIONHEAD_SOURCES',
    'set(HOMEPANEL_RENDERER_SOURCES',
  );
  for (const stationheadSource of [
    'src/sh.cpp',
    'src/sh_webview.cpp',
    'src/sh_layout.cpp',
    'src/sh_audio.cpp',
    'src/sh_audio_loss.cpp',
    'src/stationhead_native_stats.cpp',
  ]) {
    assert.match(
      stationheadSources,
      new RegExp(`^\\s{2}${stationheadSource.replaceAll('.', '\\.')}`, 'm'),
    );
  }
  assert.doesNotMatch(cmakeSource, /^\s{2}src\/stationhead_disabled_stubs\.cpp/m);
  assert.doesNotMatch(cmakeSource, /sh_profile_reuse_policy_(?:begin|end)\.h/);
  assert.match(cmakeSource, /src\/sh_track_boundary_message_policy\.h/);
  assert.match(cmakeSource, /src\/sh_startup_script\.h/);
  assert.ok(
    cmakeSource.indexOf('src/sh_track_boundary_message_policy.h') <
      cmakeSource.lastIndexOf('src/sh_startup_script.h'),
  );
});

test('App creates one Stationhead player using the former amazon WebView profile', () => {
  const startServices = section(
    appSource,
    'void App::StartServices()',
    'void App::ApplyStartupStationheadPreview()',
  );
  assert.match(startServices, /webview2-youtube-mv/);
  assert.match(appSource, /kStationheadAmazonProfile\[\] = L"spotify-v2-1"/);
  assert.match(startServices, /StationheadRole::Primary/);
  assert.match(startServices, /ReuseWebViewProfile\(kStationheadAmazonProfile\)/);
  assert.match(startServices, /stationhead_->Start\(\)/);
  const active = startServices.slice(0, startServices.indexOf('#if 0'));
  assert.doesNotMatch(active, /StationheadRole::Secondary|secondaryStationhead_\s*=/);
});

test('single Stationhead has no A-B handoff dependency', () => {
  assert.match(messages, /case WM_HP_PRIMARY_RELOAD_READY:[\s\S]*return stationhead_ \? 1 : 0/);
  assert.match(messages, /case WM_HP_SECONDARY_RELOAD_READY:[\s\S]*return 0/);
  assert.match(appSource, /stationhead_->SetBounds\(bounds\)/);
  assert.doesNotMatch(
    section(appSource, 'void App::ApplyStationheadWindowPlacement', 'void App::PublishRenderState'),
    /RECT left|RECT right|secondaryStationhead_->SetBounds/,
  );
});

test('Stationhead reuses the full-resource shared environment and profile data in place', () => {
  assert.match(sharedEnvironment, /Acquire\(userDataFolder, false, false, std::move\(completion\)\)/);
  assert.match(stationheadHeader, /void ReuseWebViewProfile\(std::wstring profileName\)/);
  assert.match(stationheadHeader, /profileName_ = std::move\(profileName\)/);
});
