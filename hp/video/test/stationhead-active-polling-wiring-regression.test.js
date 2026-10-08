import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const native = name => readFileSync(new URL(`../../native/src/${name}`, import.meta.url), 'utf8');

test('retired Stationhead play-count API is absent while runtime auth and audio health remain', () => {
  const player = native('sh.cpp');
  const webview = native('sh_webview.cpp');
  const audio = native('sh_playback_resource_policy_fix.h');
  const auth = native('sh_july19_stats_policy_fix.h');
  assert.doesNotMatch(player, /PollDailyPlayStats|StationheadApiPlayStatsScript/);
  assert.doesNotMatch(webview, /stationhead-play-stats|statsDocumentGeneration_/);
  assert.doesNotMatch(audio, /streakStats|StationheadPrimaryPlayStatsScript/);
  assert.match(audio, /TryClaimAudioHealthScanSlot/);
  assert.match(auth, /StationheadJuly19AuthAndLoginSettlementScript/);
});
