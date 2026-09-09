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

test('YouTube suppresses the phase-time badge while preserving cursor hiding', () => {
  assert.match(base, /__homePanelMediaPhaseTime/);
  assert.match(wrapper, /kNativeMediaYoutubePhaseOverlaySuppressionScript/);
  assert.match(
    wrapper,
    /document\.getElementById\('__homePanelMediaPhaseTime'\)[\s\S]*badge\.remove\(\)/,
  );
  assert.match(wrapper, /cursor:none !important/);
  assert.match(
    wrapper,
    /std::wstring_view\(script\)\.find\(L"__homePanelMediaPhaseTime"\)[\s\S]*NativeMediaWebViewSourceContains\(webview, L"youtube\.com\/"\)[\s\S]*return kNativeMediaYoutubePhaseOverlaySuppressionScript/,
  );
});

test('TVer phase-time overlay remains routed unchanged', () => {
  assert.match(base, /phase_ == Phase::YouTube \? L"YouTube " : L"TVer "/);
  assert.doesNotMatch(
    wrapper,
    /NativeMediaWebViewSourceContains\(webview, L"tver\.jp\/"\)[\s\S]{0,300}kNativeMediaYoutubePhaseOverlaySuppressionScript/,
  );
  assert.match(wrapper, /return script;/);
});
