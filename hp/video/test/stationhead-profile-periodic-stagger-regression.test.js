import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = name => readFileSync(
  new URL(`../../native/src/${name}`, import.meta.url),
  'utf8',
);

const profilePolicy = source('sh_playback_resource_policy_fix.h');
const coordinator = source('audio_health_scan_coordinator.h');
const reloadPolicy = source('sh_track_boundary_message_policy.h');
const app = source('app.cpp');
const startupCache = source('webview_startup_cache_reset.h');

test('Stationhead periodic native work uses stable one-minute profile phases', () => {
  assert.match(profilePolicy, /StationheadPeriodicProfileSlot/);
  for (let ordinal = 1; ordinal <= 6; ordinal += 1) {
    assert.match(profilePolicy, new RegExp(`spotify-v2-${ordinal}`));
  }
  assert.match(
    profilePolicy,
    /StationheadProfileAudioHealthScanDelayMs\(\s*\(now\), profileName_\)/,
  );
  assert.match(
    profilePolicy,
    /AudioHealthScanDelayMs\(now, ignoredSlot\)[\s\S]*StationheadProfileAudioHealthScanDelayMs/,
  );
  assert.match(
    profilePolicy,
    /TryClaimAudioHealthScan\(now\)[\s\S]*TryClaimAudioHealthScanSlot/,
  );
  assert.match(
    profilePolicy,
    /kAudioHealthScanRetryMs[\s\S]*StationheadProfileAudioHealthRetryMs/,
  );
  assert.match(coordinator, /kAudioHealthScanCycleMs = 6ULL \* 60ULL \* 1000ULL/);
  assert.match(coordinator, /kAudioHealthScanSlotSpacingMs = 60ULL \* 1000ULL/);
  assert.match(coordinator, /kAudioHealthScanSlotCount = 6/);
  assert.match(coordinator, /AudioHealthScanSlotDue/);
  assert.match(coordinator, /TryClaimAudioHealthScanSlot/);
});

test('Stationhead heavy lifecycle work stays staggered independently', () => {
  assert.match(
    reloadPolicy,
    /StationheadScheduledReloadStaggerMs\(\) noexcept[\s\S]*return 5 \* 60'000;/,
  );
  assert.match(
    app,
    /kMediaStartupStageDelayMs \* static_cast<int64_t>\(i \+ 1\)/,
  );
  assert.match(app, /kMediaStartupStageDelayMs \* 6/);
});

test('retired play-count polling cannot reintroduce a synchronized five-minute burst', () => {
  assert.match(
    startupCache,
    /#define kStationheadDailyPlayStatsIntervalMs 4'000'000'000'000'000'000LL/,
  );
  assert.match(
    startupCache,
    /#define StationheadApiPlayStatsScript\(channelId\) std::wstring\(L"void 0;"\)/,
  );
});
