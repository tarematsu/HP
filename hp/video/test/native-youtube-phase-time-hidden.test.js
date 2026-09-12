import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const wrapper = readFileSync(
  new URL('../../native/src/renderer_panels/media_section.inc', import.meta.url), 'utf8');
const host = readFileSync(
  new URL('../../native/src/renderer_panels/media_host.inc', import.meta.url), 'utf8');
const base = readFileSync(
  new URL('../../native/src/renderer_panels/media_section_base.inc', import.meta.url), 'utf8');

test('YouTube and TVer contain no phase-time badge or clock state', () => {
  const source = wrapper + host + base;
  assert.doesNotMatch(source, /__homePanelMediaPhaseTime/);
  assert.doesNotMatch(source, /FormatNativeMediaLocalHourMinute/);
  assert.doesNotMatch(source, /CapturePhaseTimes|BuildPhaseOverlayScript|ShowPhaseOverlay/);
  assert.doesNotMatch(source, /phaseStartText_|phaseEndText_/);
  assert.doesNotMatch(source, /kNativeMediaPhaseOverlaySuppressionScript/);
});

test('cursor hiding remains independent after clock removal', () => {
  assert.match(wrapper, /kNativeMediaCursorSuppressionScript/);
  assert.match(wrapper, /cursor:none !important/);
  assert.match(host, /AddScriptToExecuteOnDocumentCreated\(\s*kNativeMediaCursorSuppressionScript/);
  assert.match(wrapper, /script == kNativeMediaTverLoopScript/);
  assert.match(wrapper, /script == kNativeMediaTverWatchdogScript/);
  assert.match(wrapper, /script == kNativeMediaYoutubeWatchdogScript/);
});
