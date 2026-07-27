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
const policySource = readFileSync(
  new URL('../../native/src/sh_runtime_recovery_polling_policy_fix.h', import.meta.url),
  'utf8',
);

function section(source, start, end) {
  const startAt = source.indexOf(start);
  assert.notEqual(startAt, -1, `missing section: ${start}`);
  const endAt = source.indexOf(end, startAt + start.length);
  assert.notEqual(endAt, -1, `missing section terminator: ${end}`);
  return source.slice(startAt, endAt);
}

function rawString(source, declaration) {
  const declarationAt = source.indexOf(declaration);
  assert.notEqual(declarationAt, -1, `missing raw string: ${declaration}`);
  const contentAt = source.indexOf('LR"JS(', declarationAt);
  assert.notEqual(contentAt, -1, `missing raw string opener: ${declaration}`);
  const startAt = contentAt + 'LR"JS('.length;
  const endAt = source.indexOf(')JS";', startAt);
  assert.notEqual(endAt, -1, `missing raw string terminator: ${declaration}`);
  return source.slice(startAt, endAt);
}

test('recovery polling policy is compiled after lifecycle fixes', () => {
  assert.match(
    cmakeSource,
    /set\(HOMEPANEL_STATIONHEAD_SOURCES[\s\S]*src\/sh_runtime_lifecycle_policy_fix\.h[\s\S]*src\/sh_runtime_recovery_polling_policy_fix\.h[\s\S]*src\/sh_webview_event_policy\.h/,
  );
  const lifecyclePchAt = cmakeSource.indexOf(
    'target_precompile_headers(HomePanel PRIVATE\n  src/sh_runtime_lifecycle_policy_fix.h)',
  );
  const recoveryPchAt = cmakeSource.indexOf(
    'target_precompile_headers(HomePanel PRIVATE\n  src/sh_runtime_recovery_polling_policy_fix.h)',
  );
  const eventPchAt = cmakeSource.indexOf(
    'target_precompile_headers(HomePanel PRIVATE\n  src/sh_webview_event_policy.h)',
  );
  assert.ok(lifecyclePchAt >= 0 && lifecyclePchAt < recoveryPchAt);
  assert.ok(recoveryPchAt >= 0 && recoveryPchAt < eventPchAt);
});

test('every original recovery fragment matches the active runtime source', () => {
  for (const declaration of [
    'kBlankTimerState =',
    'kBlankSurfaceGate =',
    'kBlankScheduler =',
  ]) {
    const original = rawString(policySource, declaration);
    assert.ok(runtimeSource.includes(original), `${declaration} does not match runtime source`);
  }
});

test('stable playback uses one low-frequency blank recovery timeout', () => {
  const fixedState = section(
    policySource,
    'static constexpr std::wstring_view kBlankTimerStateFixed',
    'static constexpr std::wstring_view kBlankSurfaceGate',
  );
  assert.match(fixedState, /const stablePlaybackCheckMs = 30000;/);
  assert.match(fixedState, /const recoveryCheckMs = 5000;/);
  assert.match(fixedState, /let checkTimer = 0;/);
  assert.doesNotMatch(fixedState, /nativeSetInterval|nativeClearInterval|loadCheckTimer/);

  const fixedScheduler = section(
    policySource,
    'static constexpr std::wstring_view kBlankSchedulerFixed',
    'const bool timerStateReplaced',
  );
  assert.match(fixedScheduler, /const isPlaying = playing\(\);/);
  assert.match(
    fixedScheduler,
    /if \(isPlaying\)[\s\S]*clearReloadAt\(\);[\s\S]*schedule\(stablePlaybackCheckMs\);/,
  );
  assert.match(
    fixedScheduler,
    /if \(protectedInteractionVisible\(\)\)[\s\S]*schedule\(recoveryCheckMs\);/,
  );
  assert.doesNotMatch(fixedScheduler, /nativeSetInterval|loadCheckTimer/);
});

test('playback and document transitions re-arm recovery safely', () => {
  const fixedScheduler = section(
    policySource,
    'static constexpr std::wstring_view kBlankSchedulerFixed',
    'const bool timerStateReplaced',
  );
  assert.match(
    fixedScheduler,
    /\['play','playing','canplay','pause','ended','stalled','waiting','error'\]/,
  );
  assert.match(
    fixedScheduler,
    /recheckAfterPlaybackStateChange[\s\S]*reschedule\(mediaStateRecheckMs\)/,
  );
  assert.match(
    fixedScheduler,
    /visibilitychange[\s\S]*cancelCheck\(\);[\s\S]*cancelReload\(\);[\s\S]*reschedule\(\);/,
  );
  assert.match(
    fixedScheduler,
    /addEventListener\('pagehide', stop, true\)/,
  );
  assert.match(
    fixedScheduler,
    /addEventListener\('pageshow',[\s\S]*pageActive = true;[\s\S]*reschedule\(\);/,
  );
  assert.match(
    fixedScheduler,
    /const isStillPlaying = playing\(\);[\s\S]*!isStillPlaying[\s\S]*protectedInteractionVisible\(\)[\s\S]*sparseDarkSurface\(\)[\s\S]*location\.reload\(\)/,
  );
});

test('all generated-source replacement markers are pinned', () => {
  for (const marker of [
    'timerStateReplaced',
    'surfaceGateReplaced',
    'schedulerReplaced',
  ]) {
    assert.match(policySource, new RegExp(`const bool ${marker}`));
    assert.match(policySource, new RegExp(`\\(void\\)${marker};`));
  }
  assert.match(
    policySource,
    /StationheadAutoplayScriptLifecycleFixed\(globalName, messagePrefix\)/,
  );
  assert.match(
    policySource,
    /#undef StationheadAutoplayScript[\s\S]*#define StationheadAutoplayScript StationheadAutoplayScriptRecoveryPollingFixed/,
  );
});
