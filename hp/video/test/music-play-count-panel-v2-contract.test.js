import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const entry = readFileSync(
  new URL('../../native/src/renderer_panels/media_section_base.inc', import.meta.url),
  'utf8',
);
const radarSection = readFileSync(
  new URL('../../native/src/renderer_panels/radar_section.inc', import.meta.url),
  'utf8',
);
const july19Policy = readFileSync(
  new URL('../../native/src/sh_july19_stats_policy_fix.h', import.meta.url),
  'utf8',
);
const activePolicy = readFileSync(
  new URL('../../native/src/sh_playback_resource_policy_fix.h', import.meta.url),
  'utf8',
);

test('the compiled media panel uses the integrated YouTube and TVer surface', () => {
  assert.match(entry, /HomePanelNativeMvPanel/);
  assert.match(radarSection, /void Renderer::DrawRadarSection/);
  assert.match(entry, /kNativeMediaYoutubeUrl/);
  assert.doesNotMatch(entry, /kNativeMediaTverUrl|data:text\/html/);
  assert.match(entry, /#include "media_host\.inc"/);
  assert.doesNotMatch(entry, /radar_section\.inc/);
  assert.doesNotMatch(entry, /#include "mv_section\.inc"/);
  assert.doesNotMatch(entry, /media_section_v2\.inc/);
});

test('play-count acquisition uses PR48 authenticated Primary WebView polling', () => {
  assert.match(july19Policy, /StationheadJuly19AuthCaptureScript/);
  assert.match(july19Policy, /window\.fetch = function\(input, init\)/);
  assert.match(july19Policy, /NativeXhr\.prototype\.send = function/);
  assert.match(activePolicy, /StationheadPrimaryPlayStatsScript/);
  assert.match(activePolicy, /window\.__homepanelStationheadAuthHeaders/);
  assert.match(activePolicy, /if \(!headers\?\.authorization\)/);
  assert.match(activePolicy, /credentials: 'include'/);
  assert.match(activePolicy, /\/streakStats/);
  assert.match(activePolicy, /10 \* 60 \* 1000/);
});
