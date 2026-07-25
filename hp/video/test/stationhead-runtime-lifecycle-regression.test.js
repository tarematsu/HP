import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const cmakeSource = readFileSync(
  new URL('../../native/CMakeLists.txt', import.meta.url),
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

test('lifecycle policy is compiled after login policy and before resource policy', () => {
  assert.match(
    cmakeSource,
    /set\(HOMEPANEL_STATIONHEAD_SOURCES[\s\S]*src\/sh_runtime_policy_fix\.h[\s\S]*src\/sh_runtime_lifecycle_policy_fix\.h[\s\S]*src\/sh_runtime_resource_policy_fix\.h/,
  );
  assert.match(
    cmakeSource,
    /target_precompile_headers\(HomePanel PRIVATE[\s\S]*src\/sh_runtime_policy_fix\.h[\s\S]*src\/sh_runtime_lifecycle_policy_fix\.h\)/,
  );
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

test('every lifecycle marker is pinned and the final autoplay macro uses it', () => {
  for (const marker of [
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
