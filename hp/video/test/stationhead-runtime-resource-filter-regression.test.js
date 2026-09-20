import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const readNative = name => readFileSync(
  new URL(`../../native/src/${name}`, import.meta.url), 'utf8');

const cmakeSource = readNative('../CMakeLists.txt');
const policySource = readNative('sh_runtime_resource_filter_policy_fix.h');
const environmentSource = readNative('shared_webview_environment.cpp');
const environmentHeader = readNative('shared_webview_environment.h');

test('resource filter reduction remains the final Stationhead resource layer', () => {
  assert.match(cmakeSource, /sh_runtime_resource_boundary_policy_fix\.h/);
  assert.match(cmakeSource, /sh_runtime_resource_filter_policy_fix\.h/);
  assert.match(cmakeSource, /sh_track_boundary_message_policy\.h/);
  assert.match(
    policySource,
    /#undef ApplyStationheadResourceBlocking[\s\S]*#define ApplyStationheadResourceBlocking ApplyStationheadResourceBlockingFilterFixed/,
  );
});

test('Stationhead worker filters are scoped to the restored ozeki profile', () => {
  assert.match(policySource, /ICoreWebView2_13/);
  assert.match(policySource, /get_Profile\(&profile\)/);
  assert.match(policySource, /get_ProfileName\(&profileNameRaw\)/);
  assert.match(policySource, /_wcsicmp\(profileNameRaw, L"spotify-v2-6"\) == 0/);
  assert.match(
    policySource,
    /The restored\s*\n\s*\/\/ single Stationhead instance owns the ozeki profile/,
  );
});

test('shared media environment keeps background playback schedulers active', () => {
  assert.match(environmentSource, /kSharedWebView2LifecycleArguments/);
  assert.match(environmentSource, /--disable-backgrounding-occluded-windows/);
  assert.match(environmentSource, /--disable-renderer-backgrounding/);
  assert.match(environmentSource, /--disable-background-timer-throttling/);
  assert.match(environmentSource, /--autoplay-policy=no-user-gesture-required/);
  assert.match(environmentSource, /std::wstring webView2Arguments = kSharedWebView2LifecycleArguments/);
});

test('shared UDF keeps global image/font reduction for media profiles', () => {
  assert.match(environmentHeader, /Acquire\(userDataFolder, true, true, std::move\(completion\)\)/);
  assert.match(environmentSource, /imagesEnabled=false,loadsImagesAutomatically=false/);
  assert.match(environmentSource, /downloadableBinaryFontsEnabled=false/);
});
