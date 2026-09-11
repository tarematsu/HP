import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const wrapper = readFileSync(
  new URL('../../native/src/renderer_panels/media_section.inc', import.meta.url), 'utf8');
const host = readFileSync(
  new URL('../../native/src/renderer_panels/media_host.inc', import.meta.url), 'utf8');

test('YouTube and TVer suppress the phase-time badge while preserving cursor hiding', () => {
  assert.match(host, /__homePanelMediaPhaseTime/);
  assert.match(wrapper, /kNativeMediaPhaseOverlaySuppressionScript/);
  assert.match(
    wrapper,
    /document\.getElementById\('__homePanelMediaPhaseTime'\)[\s\S]*badge\.remove\(\)/,
  );
  assert.match(wrapper, /cursor:none !important/);
  assert.match(
    wrapper,
    /std::wstring_view\(script\)\.find\(L"__homePanelMediaPhaseTime"\)[\s\S]*return kNativeMediaPhaseOverlaySuppressionScript/,
  );
});

test('phase-time suppression remains independent from playback routing', () => {
  const phaseGuard = wrapper.indexOf(
    'std::wstring_view(script).find(L"__homePanelMediaPhaseTime")',
  );
  const tverLoop = wrapper.indexOf('script == kNativeMediaTverLoopScript', phaseGuard);
  assert.ok(phaseGuard >= 0 && tverLoop > phaseGuard);
  assert.doesNotMatch(wrapper.slice(phaseGuard, tverLoop), /youtube\.com|tver\.jp/);

  assert.match(wrapper, /script == kNativeMediaTverLoopScript/);
  assert.match(wrapper, /script == kNativeMediaTverWatchdogScript/);
  assert.match(wrapper, /script == kNativeMediaYoutubeWatchdogScript/);
  assert.match(wrapper, /kNativeMediaYoutubeControlRecoveryScript/);
  assert.match(wrapper, /kNativeMediaTverEpisodeLoopPolicyScript/);
  assert.match(wrapper, /kNativeMediaTverPlaybackWatchdogPolicyScript/);
  assert.match(wrapper, /return script;/);
});
