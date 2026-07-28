import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const readNative = relative => readFileSync(
  new URL(`../../native/src/${relative}`, import.meta.url),
  'utf8',
);

const audio = readNative('sh_audio.cpp');
const app = readNative('app.cpp');
const handles = readNative('app_stationhead_handles.cpp');
const assets = readNative('embedded_ui.cpp');

function section(source, start, end) {
  const startAt = source.indexOf(start);
  assert.notEqual(startAt, -1, `missing section: ${start}`);
  const endAt = source.indexOf(end, startAt + start.length);
  assert.notEqual(endAt, -1, `missing section terminator: ${end}`);
  return source.slice(startAt, endAt);
}

test('dashboard A/B and MUTE actions use only the native WebView2 mute API', () => {
  const setMuted = section(
    audio,
    'void StationheadPlayer::SetMuted(bool muted) noexcept',
    'bool StationheadPlayer::Muted() const noexcept',
  );
  assert.match(setMuted, /ApplyMute\(\)/);
  assert.doesNotMatch(setMuted, /ApplyVolume|ExecuteScript|StationheadVolumeScript/);

  const applyMute = section(
    audio,
    'void StationheadPlayer::ApplyMute() const noexcept',
    'void StationheadPlayer::ApplyVolume() const noexcept',
  );
  assert.match(applyMute, /ComPtr<ICoreWebView2> webview = webview_/);
  assert.match(applyMute, /put_IsMuted/);
  assert.doesNotMatch(applyMute, /ApplyVolume|ExecuteScript|StationheadVolumeScript/);

  const profile = section(
    app,
    'void App::ApplyScheduledStationheadAudioProfile(bool primaryAudible) noexcept',
    'void App::ScheduleNextTick(',
  );
  assert.match(profile, /SetAudioMuted\(primaryMuted\)/);
  assert.match(profile, /SetAudioMuted\(secondaryMuted\)/);
  assert.doesNotMatch(profile, /SetVolume|ExecuteScript/);

  const handleMute = section(
    handles,
    'void StationheadHandleBase::SetAudioMuted(bool muted) noexcept',
    'void StationheadHandleBase::SetBounds(',
  );
  assert.match(handleMute, /player_->SetMuted\(muted\)/);
  assert.doesNotMatch(handleMute, /SetVolume|ExecuteScript/);
});

test('dashboard runtime does not install JavaScript UI files', () => {
  const runtimeAssets = section(
    assets,
    'constexpr RuntimeAsset kRuntimeAssets[]',
    'void AppendAssetStamp(',
  );
  assert.match(runtimeAssets, /radar-satellite\.png/);
  assert.match(runtimeAssets, /radar-map\.png/);
  assert.doesNotMatch(runtimeAssets, /\.js/);

  const obsolete = section(
    assets,
    'void RemoveObsoleteDashboardFiles(',
    '}  // namespace',
  );
  assert.match(obsolete, /L"app\.js"/);
  assert.match(obsolete, /L"stationhead-audio-controls\.js"/);
  assert.match(assets, /RemoveObsoleteDashboardFiles\(folder\)/);
});
