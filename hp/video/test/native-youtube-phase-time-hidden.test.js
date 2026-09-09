import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const wrapper = readFileSync(
  new URL('../../native/src/renderer_panels/media_section.inc', import.meta.url),
  'utf8',
);
const base = readFileSync(
  new URL('../../native/src/renderer_panels/media_section_base.inc', import.meta.url),
  'utf8',
);

test('YouTube and TVer suppress the phase-time badge while preserving cursor hiding', () => {
  assert.match(base, /__homePanelMediaPhaseTime/);
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
  const phaseGuardStart = wrapper.indexOf(
    'std::wstring_view(script).find(L"__homePanelMediaPhaseTime")',
  );
  const resolverStart = wrapper.indexOf('const wchar_t* ResolveNativeMediaPolicyScript(');
  const tverRoutingStart = wrapper.indexOf(
    'if (script == kNativeMediaTverWatchdogScript)',
    resolverStart + 1,
  );
  assert.ok(phaseGuardStart >= 0 && tverRoutingStart > phaseGuardStart);
  const phaseGuard = wrapper.slice(phaseGuardStart, tverRoutingStart);
  assert.doesNotMatch(phaseGuard, /youtube\.com|tver\.jp/);
});

test('phase-time suppression is independent from YouTube/TVer playback routing', () => {
  assert.match(wrapper, /script == kNativeMediaTverWatchdogScript/);
  assert.match(wrapper, /script == kNativeMediaYoutubeWatchdogScript/);
  assert.match(wrapper, /return kNativeMediaYoutubeWatchdogPolicyScript/);
  assert.match(wrapper, /return kNativeMediaTverPlaybackWatchdogPolicyScript/);
  assert.match(wrapper, /return script;/);
});
