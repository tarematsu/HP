import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const entry = readFileSync(
  new URL('../../native/src/renderer_panels/media_section.inc', import.meta.url),
  'utf8',
);
const panel = readFileSync(
  new URL('../../native/src/renderer_panels/media_section_v2.inc', import.meta.url),
  'utf8',
);
const policy = readFileSync(
  new URL('../../native/src/sh_stats_session_policy_fix.h', import.meta.url),
  'utf8',
);

test('the compiled Music panel uses the v2 implementation', () => {
  assert.match(entry, /#include "media_section_v2\.inc"/);
  assert.match(panel, /void Renderer::DrawMusicSection/);
});

test('every requested period has an independently rendered value cell', () => {
  for (const label of ['直近1時間', '本日', '昨日', '今週', '先週']) {
    assert.match(panel, new RegExp(`L"${label}"`));
  }
  assert.match(panel, /for \(size_t index = 0; index < kPlayMetricLabels\.size\(\); \+\+index\)/);
  assert.match(panel, /DrawWidgetCard\(dc, cell/);
  assert.match(panel, /DrawTextInRect\(dc, playMetricValues\[index\]/);
  assert.match(panel, /L"--"/);
});

test('one request lifecycle publishes the identities required by native', () => {
  assert.match(policy, /type: 'stationhead-stats-document'/);
  assert.match(policy, /type: 'stationhead-auth-ready'/);
  assert.match(policy, /type: 'stationhead-play-stats'/);
  assert.match(policy, /request_id: requestId/);
  assert.match(policy, /document_generation: documentGeneration/);
  assert.match(policy, /auth_generation: authGeneration/);
  assert.match(policy, /__homepanelStationheadPlayStatsInFlight/);
});
