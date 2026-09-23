import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = name => readFileSync(
  new URL(`../../native/src/${name}`, import.meta.url),
  'utf8',
);

const runtime = source('sh_runtime_onboarding_script.h');
const clickPolicy = source('sh_onboarding_click_policy.h');

function section(text, start, end) {
  const at = text.indexOf(start);
  assert.ok(at >= 0, `missing section start: ${start}`);
  const until = end ? text.indexOf(end, at + start.length) : text.length;
  assert.ok(until > at, `missing section end: ${end}`);
  return text.slice(at, until);
}

test('Keep Streaming is published before the shared onboarding allowlist path', () => {
  assert.ok(runtime.includes('const keepStreamingPattern = /^keep\\s+streaming$/i;'));

  const keepStreaming = section(
    runtime,
    'const publishKeepStreaming = () => {',
    'const splitConnectSurfaceVisible = () => {',
  );
  assert.match(keepStreaming, /keepStreamingVisible\(\)/);
  assert.match(keepStreaming, /postText\('start-visible'\)/);
  assert.doesNotMatch(keepStreaming, /playbackEstablished|playing\(\)/);

  const publish = section(
    runtime,
    'const publishRecoverableOnboarding = () => {',
    ')JS";',
  );
  const continuationAt = publish.indexOf('if (publishKeepStreaming()) return true;');
  const onboardingAt = publish.indexOf('!recoverableOnboardingVisible()');
  assert.ok(continuationAt >= 0 && onboardingAt > continuationAt);
  assert.doesNotMatch(publish, /playbackEstablished|\bplaying\(\)/);
});

test('Keep Streaming uses a trusted CDP locator that is independent of audio state', () => {
  const locator = section(
    clickPolicy,
    'inline std::wstring StationheadLocateKeepStreamingScript()',
    'inline bool DispatchLocatedTrustedAction(',
  );

  assert.ok(locator.includes('const keepStreamingPattern = /^keep\\s+streaming$/i;'));
  assert.match(locator, /document\.elementFromPoint\(x, y\)/);
  assert.match(locator, /element\.scrollIntoView\(/);
  assert.doesNotMatch(
    locator,
    /__homepanelAudioPlaying|navigator\.mediaSession|\bplaying\s*\(/,
  );
});

test('Keep Streaming is attempted before the existing onboarding fallback', () => {
  const attempt = section(
    clickPolicy,
    'inline void AttemptTrustedOnboardingClick(',
    'inline ComPtr<ICoreWebView2WebMessageReceivedEventHandler>',
  );

  const keepAt = attempt.indexOf('StationheadLocateKeepStreamingScript()');
  const fallbackAt = attempt.indexOf('AttemptTrustedOnboardingFallbackClick(view)');
  assert.ok(keepAt >= 0 && fallbackAt > keepAt);
  assert.match(clickPolicy, /Input\.dispatchMouseEvent/);
});
