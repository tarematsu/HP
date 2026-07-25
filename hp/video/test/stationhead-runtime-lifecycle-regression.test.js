import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const cmakeSource = readFileSync(
  new URL('../../native/CMakeLists.txt', import.meta.url),
  'utf8',
);
const runtimeSource = readFileSync(
  new URL('../../native/src/sh_runtime_policy_fix.h', import.meta.url),
  'utf8',
);
const lifecycleSource = readFileSync(
  new URL('../../native/src/sh_runtime_lifecycle_policy_fix.h', import.meta.url),
  'utf8',
);

function section(source, start, end) {
  const startAt = source.indexOf(start);
  assert.notEqual(startAt, -1, `missing section: ${start}`);
  const endAt = source.indexOf(end, startAt + start.length);
  assert.notEqual(endAt, -1, `missing section terminator: ${end}`);
  return source.slice(startAt, endAt);
}

function occurrences(source, needle) {
  return source.split(needle).length - 1;
}

test('lifecycle policy is compiled between login and resource policies', () => {
  assert.match(
    cmakeSource,
    /set\(HOMEPANEL_STATIONHEAD_SOURCES[\s\S]*src\/sh_runtime_policy_fix\.h[\s\S]*src\/sh_runtime_lifecycle_policy_fix\.h[\s\S]*src\/sh_runtime_resource_policy_fix\.h/,
  );
  const loginPchAt = cmakeSource.indexOf(
    'target_precompile_headers(HomePanel PRIVATE\n  src/sh_polling_policy.h\n  src/sh_runtime_policy_fix.h)',
  );
  const lifecyclePchAt = cmakeSource.indexOf(
    'target_precompile_headers(HomePanel PRIVATE\n  src/sh_runtime_lifecycle_policy_fix.h)',
  );
  const resourcePchAt = cmakeSource.indexOf(
    'target_precompile_headers(HomePanel PRIVATE\n  src/sh_runtime_resource_policy_fix.h)',
  );
  assert.ok(loginPchAt >= 0 && loginPchAt < lifecyclePchAt);
  assert.ok(lifecyclePchAt >= 0 && lifecyclePchAt < resourcePchAt);
});

test('obsolete Stationhead documents cancel and do not re-arm login timers', () => {
  const wrapper = section(
    lifecycleSource,
    'inline std::wstring StationheadAutoplayScriptLifecycleFixed(',
    '}  // namespace hp',
  );
  assert.match(
    wrapper,
    /StationheadAutoplayScriptRuntimeFixed\(globalName, messagePrefix\)/,
  );
  assert.match(wrapper, /const nativeClearTimeout = window\.clearTimeout\.bind\(window\);/);
  assert.match(wrapper, /if \(!pageActive \|\| timer\) return;/);
  assert.match(
    wrapper,
    /timer = nativeTimeout\(\(\) => \{[\s\S]*if \(!pageActive\) return;[\s\S]*schedule\(\);/,
  );
  assert.match(
    wrapper,
    /addEventListener\('pagehide',[\s\S]*pageActive = false;[\s\S]*nativeClearTimeout\(timer\);[\s\S]*timer = 0;/,
  );
  assert.match(
    wrapper,
    /addEventListener\('pageshow',[\s\S]*pageActive = true;[\s\S]*scan\(\);[\s\S]*schedule\(\);/,
  );
  assert.match(
    wrapper,
    /const scan = \(\) => \{[\s\S]*if \(!pageActive\) return;[\s\S]*baseScan\(\);/,
  );
});

test('base autoplay and UI observers stop across BFCache transitions', () => {
  assert.match(lifecycleSource, /let pageActive = true;/);
  assert.match(lifecycleSource, /if \(!pageActive \|\| scanQueued\) return;/);
  assert.match(lifecycleSource, /const delayedScanTimer = nativeTimeout\(schedule, 15000\);/);
  assert.match(lifecycleSource, /nativeClearTimeout\(delayedScanTimer\);/);
  assert.match(lifecycleSource, /observer\?\.disconnect\?\.\(\);/);
  assert.match(lifecycleSource, /window\.addEventListener\('pagehide', pauseObserver, true\);/);
  assert.match(lifecycleSource, /window\.addEventListener\('pageshow', resumeObserver, true\);/);
});

test('login timer replacement marker is unique in its generated source', () => {
  const marker = [
    '  const nativeTimeout = window.setTimeout.bind(window);',
    "  const normalize = value => String(value || '').replace(/\\s+/g, ' ').trim();",
  ].join('\n');
  assert.equal(occurrences(runtimeSource, marker), 1);
  assert.equal(occurrences(lifecycleSource, 'static constexpr std::wstring_view kTimerDeclaration ='), 1);
  assert.match(
    lifecycleSource,
    /kTimerDeclaration = LR"JS\(  const nativeTimeout = window\.setTimeout\.bind\(window\);[\s\S]*const normalize = value/,
  );
});

test('every lifecycle marker is pinned and the final autoplay macro uses it', () => {
  for (const marker of [
    'uiLifecycleReplaced',
    'baseStateReplaced',
    'baseScanReplaced',
    'baseScheduleReplaced',
    'baseTailReplaced',
    'timerDeclarationReplaced',
    'scanReplaced',
    'scheduleReplaced',
    'lifecycleReplaced',
  ]) {
    assert.match(lifecycleSource, new RegExp(`const bool ${marker}`));
    assert.match(lifecycleSource, new RegExp(`\\(void\\)${marker};`));
  }
  assert.match(
    lifecycleSource,
    /#undef StationheadAutoplayScript[\s\S]*#define StationheadAutoplayScript StationheadAutoplayScriptLifecycleFixed/,
  );
});
