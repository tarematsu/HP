import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const source = name => readFileSync(
  new URL(`../../native/src/${name}`, import.meta.url), 'utf8');

const onboarding = source('sh_runtime_onboarding_script.h');
const locator = source('sh_start_button_locator_policy.h');

function section(text, start, end) {
  const startAt = text.indexOf(start);
  assert.notEqual(startAt, -1, `missing section: ${start}`);
  const endAt = text.indexOf(end, startAt + start.length);
  assert.notEqual(endAt, -1, `missing section terminator: ${end}`);
  return text.slice(startAt, endAt);
}

test('CONNECT SPOTIFY is detected across button, heading and non-semantic markup', () => {
  assert.match(onboarding, /recoverableOnboardingPattern/);
  assert.match(onboarding, /onboardingCandidateSelector/);
  assert.match(onboarding, /h1,h2,h3,\[role='heading'\],div,span,p/);
  assert.match(onboarding, /onboardingMatches\(element, recoverableOnboardingPattern\)/);
  assert.doesNotMatch(onboarding, /join\s+the\s+party/i);
});

test('CONNECT SPOTIFY is eligible before first playback and with stale audio state', () => {
  const publish = section(
    onboarding,
    'const publishRecoverableOnboarding = () => {',
    ')JS";',
  );
  assert.match(publish, /recoverableOnboardingVisible\(\)/);
  assert.match(publish, /releasePlaybackOnlyForOnboarding\(\)/);
  assert.doesNotMatch(publish, /playbackEstablished|\bplaying\(\)/);
  assert.match(publish, /postText\('start-visible'\)/);
});

test('native trusted locator prefers actionable controls then split dialog then text fallback', () => {
  assert.match(locator, /allowedOnboardingPattern/);
  assert.match(locator, /const candidateSelector =/);
  assert.match(locator, /h1,h2,h3,\[role='heading'\],div,span,p/);
  assert.match(locator, /const clickableTargetFor = element =>/);
  assert.match(locator, /typeof current\.onclick === 'function'/);
  assert.match(locator, /style\.cursor === 'pointer'/);
  const body = section(
    locator,
    '// Every recoverable music-service action is current-state driven and',
    '// Playback-start actions remain blocked',
  );
  const actionableAt = body.indexOf('actionablePointForPattern(allowedOnboardingPattern)');
  const splitAt = body.indexOf('splitConnectSurfacePoint()');
  const plainAt = body.indexOf('plainPointForPattern(allowedOnboardingPattern)');
  assert.ok(actionableAt >= 0 && splitAt > actionableAt && plainAt > splitAt);
  assert.doesNotMatch(locator, /join\s+the\s+party/i);
});

test('trusted locator hits the label inside a wide clickable surface', () => {
  const policy = source('sh_recoverable_action_policy.h');
  const pattern = policy.match(/kStationheadRecoverableActionPattern = LR"JS\\((.*?)\\)JS"/s)?.[1];
  assert.ok(pattern);
  const script = [...locator.matchAll(/LR"JS\\(([\\s\\S]*?)\\)JS"/g)]
    .map(match => match[1]).join('')
    .replace('{{RECOVERABLE_ACTION_PATTERN}}', pattern);

  for (const pseudoOnly of [false, true]) {
    class Element {}
    class HTMLElement extends Element {}
    const box = (left, top, width, height) =>
      ({ left, top, width, height, right: left + width, bottom: top + height });
    const parent = new HTMLElement();
    const label = new HTMLElement();
    label.parentElement = parent;
    parent.parentElement = null;
    parent.isConnected = label.isConnected = true;
    parent.tagName = label.tagName = 'DIV';
    parent.disabled = label.disabled = false;
    parent.getAttribute = label.getAttribute = () => null;
    parent.getBoundingClientRect = () => box(0, 0, 360, 900);
    label.getBoundingClientRect = () => box(40, 60, 120, 30);
    label.innerText = label.textContent = pseudoOnly ? '' : 'Connect Spotify';
    parent.innerText = parent.textContent = '';
    parent.contains = child => child === label;
    label.contains = () => false;
    const document = {
      body: {},
      querySelectorAll: () => [label],
      elementFromPoint: (x, y) => y < 100 ? label : { overlay: true },
    };
    const window = { top: null };
    window.top = window;
    const context = {
      window, document, Element, HTMLElement, location: { hostname: 'stationhead.com' },
      navigator: {}, innerWidth: 360, innerHeight: 960,
      getComputedStyle: (element, pseudo) => ({
        display: 'block', visibility: 'visible', opacity: '1',
        pointerEvents: 'auto', cursor: element === parent ? 'pointer' : 'auto',
        content: element === label && pseudo === '::before' && pseudoOnly
          ? '"Connect Spotify"' : 'none',
      }),
    };
    const point = runInNewContext(script, context);
    assert.deepEqual({ x: point?.x, y: point?.y }, { x: 100, y: 75 });
  }
});
