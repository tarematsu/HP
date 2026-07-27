#pragma once

namespace hp {

// Blank-page recovery is a fallback for a failed Stationhead render, not part of
// the active playback path. Replace its permanent five-second interval with one
// document-owned adaptive timeout. Stable audio needs only a low-frequency
// liveness check; playback, visibility and BFCache transitions re-arm the fast
// recovery cadence immediately without changing the reload safety gates.
inline std::wstring StationheadAutoplayScriptRecoveryPollingFixed(
    const wchar_t* globalName,
    const wchar_t* messagePrefix) {
  std::wstring script =
      StationheadAutoplayScriptLifecycleFixed(globalName, messagePrefix);

  static constexpr std::wstring_view kBlankTimerState = LR"JS(  const nativeSetInterval = window.setInterval.bind(window);
  const nativeClearInterval = window.clearInterval.bind(window);
  const nativeSetTimeout = window.setTimeout.bind(window);
  const nativeClearTimeout = window.clearTimeout.bind(window);
  const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
  const observedAt = Date.now();
  const reloadKey = '__homepanelStationheadBlankReloadAt';
  const interactiveSelector = "button,[role='button'],a,input,select,textarea,[tabindex],[aria-label],[data-testid]";
  const credentialSelector = "input[type='password'],input[type='email'],input[autocomplete='username'],input[autocomplete='current-password']";
  const protectedPattern = /\b(start listening|listen now|listen live|join station|join room|resume|continue|play|pause|spotify|connect spotify|log in|sign in|login)\b|視聴を開始|再生|一時停止|続ける|続行|次へ|ログイン|サインイン|接続/i;
  let pageActive = true;
  let blankSince = 0;
  let interval = 0;
  let reloadTimer = 0;
  let loadCheckTimer = 0;
)JS";
  static constexpr std::wstring_view kBlankTimerStateFixed = LR"JS(  const nativeSetTimeout = window.setTimeout.bind(window);
  const nativeClearTimeout = window.clearTimeout.bind(window);
  const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
  const observedAt = Date.now();
  const reloadKey = '__homepanelStationheadBlankReloadAt';
  const interactiveSelector = "button,[role='button'],a,input,select,textarea,[tabindex],[aria-label],[data-testid]";
  const credentialSelector = "input[type='password'],input[type='email'],input[autocomplete='username'],input[autocomplete='current-password']";
  const protectedPattern = /\b(start listening|listen now|listen live|join station|join room|resume|continue|play|pause|spotify|connect spotify|log in|sign in|login)\b|視聴を開始|再生|一時停止|続ける|続行|次へ|ログイン|サインイン|接続/i;
  const stablePlaybackCheckMs = 30000;
  const recoveryCheckMs = 5000;
  const mediaStateRecheckMs = 250;
  let pageActive = true;
  let blankSince = 0;
  let checkTimer = 0;
  let reloadTimer = 0;
)JS";

  static constexpr std::wstring_view kBlankSurfaceGate = LR"JS(  const sparseDarkSurface = () => {
    if (!pageActive || document.visibilityState === 'hidden' ||
        document.readyState !== 'complete' || !document.body ||
        innerWidth < 100 || innerHeight < 100 || playing() ||
        protectedInteractionVisible()) {
      return false;
    }
)JS";
  static constexpr std::wstring_view kBlankSurfaceGateFixed = LR"JS(  const sparseDarkSurface = () => {
    if (!pageActive || document.visibilityState === 'hidden' ||
        document.readyState !== 'complete' || !document.body ||
        innerWidth < 100 || innerHeight < 100) {
      return false;
    }
)JS";

  static constexpr std::wstring_view kBlankScheduler = LR"JS(  const check = () => {
    if (!pageActive) return;
    const now = Date.now();
    if (playing() || protectedInteractionVisible()) {
      blankSince = 0;
      cancelReload();
      if (playing()) clearReloadAt();
      return;
    }
    if (now - observedAt < 30000 || !sparseDarkSurface()) {
      blankSince = 0;
      cancelReload();
      return;
    }
    if (!blankSince) {
      blankSince = now;
      return;
    }
    if (now - blankSince < 15000 || reloadTimer) return;
    const lastReloadAt = readLastReloadAt();
    if (lastReloadAt > 0 && now - lastReloadAt < 120000) {
      blankSince = now;
      return;
    }
    writeLastReloadAt(now);
    reloadTimer = nativeSetTimeout(() => {
      reloadTimer = 0;
      if (pageActive && !playing() && !protectedInteractionVisible() &&
          sparseDarkSurface()) {
        location.reload();
      }
    }, 50);
  };
  const start = () => {
    if (!pageActive || interval) return;
    interval = nativeSetInterval(check, 5000);
  };
  const stop = () => {
    pageActive = false;
    blankSince = 0;
    if (interval) {
      nativeClearInterval(interval);
      interval = 0;
    }
    cancelReload();
    if (loadCheckTimer) {
      nativeClearTimeout(loadCheckTimer);
      loadCheckTimer = 0;
    }
  };

  window.addEventListener('pagehide', stop, true);
  window.addEventListener('pageshow', () => {
    pageActive = true;
    start();
    check();
  }, true);
  window.addEventListener('load', () => {
    loadCheckTimer = nativeSetTimeout(() => {
      loadCheckTimer = 0;
      if (pageActive) check();
    }, 30000);
  }, { once: true });
  start();
)JS";
  static constexpr std::wstring_view kBlankSchedulerFixed = LR"JS(  const cancelCheck = () => {
    if (!checkTimer) return;
    nativeClearTimeout(checkTimer);
    checkTimer = 0;
  };
  const schedule = delay => {
    if (!pageActive || document.visibilityState === 'hidden' || checkTimer) return;
    checkTimer = nativeSetTimeout(() => {
      checkTimer = 0;
      check();
    }, delay);
  };
  const reschedule = (delay = 0) => {
    cancelCheck();
    schedule(delay);
  };
  const check = () => {
    if (!pageActive || document.visibilityState === 'hidden') return;
    const now = Date.now();
    const isPlaying = playing();
    if (isPlaying) {
      blankSince = 0;
      cancelReload();
      clearReloadAt();
      schedule(stablePlaybackCheckMs);
      return;
    }
    if (protectedInteractionVisible()) {
      blankSince = 0;
      cancelReload();
      schedule(recoveryCheckMs);
      return;
    }
    if (now - observedAt < 30000 || !sparseDarkSurface()) {
      blankSince = 0;
      cancelReload();
      schedule(recoveryCheckMs);
      return;
    }
    if (!blankSince) {
      blankSince = now;
      schedule(recoveryCheckMs);
      return;
    }
    if (now - blankSince < 15000 || reloadTimer) {
      schedule(recoveryCheckMs);
      return;
    }
    const lastReloadAt = readLastReloadAt();
    if (lastReloadAt > 0 && now - lastReloadAt < 120000) {
      blankSince = now;
      schedule(recoveryCheckMs);
      return;
    }
    writeLastReloadAt(now);
    reloadTimer = nativeSetTimeout(() => {
      reloadTimer = 0;
      if (!pageActive || document.visibilityState === 'hidden') return;
      const isStillPlaying = playing();
      if (!isStillPlaying && !protectedInteractionVisible() &&
          sparseDarkSurface()) {
        location.reload();
      }
    }, 50);
    schedule(recoveryCheckMs);
  };
  const stop = () => {
    pageActive = false;
    blankSince = 0;
    cancelCheck();
    cancelReload();
  };
  const recheckAfterPlaybackStateChange = () => {
    if (pageActive && document.visibilityState !== 'hidden') {
      reschedule(mediaStateRecheckMs);
    }
  };

  for (const eventName of ['play','playing','canplay','pause','ended','stalled','waiting','error']) {
    document.addEventListener(eventName, recheckAfterPlaybackStateChange, true);
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      blankSince = 0;
      cancelCheck();
      cancelReload();
    } else if (pageActive) {
      reschedule();
    }
  });
  window.addEventListener('pagehide', stop, true);
  window.addEventListener('pageshow', () => {
    pageActive = true;
    reschedule();
  }, true);
  schedule(recoveryCheckMs);
)JS";

  const bool timerStateReplaced = ReplaceStationheadRuntimeFragment(
      script, kBlankTimerState, kBlankTimerStateFixed);
  const bool surfaceGateReplaced = ReplaceStationheadRuntimeFragment(
      script, kBlankSurfaceGate, kBlankSurfaceGateFixed);
  const bool schedulerReplaced = ReplaceStationheadRuntimeFragment(
      script, kBlankScheduler, kBlankSchedulerFixed);
  (void)timerStateReplaced;
  (void)surfaceGateReplaced;
  (void)schedulerReplaced;
  return script;
}

}  // namespace hp

#undef StationheadAutoplayScript
#define StationheadAutoplayScript StationheadAutoplayScriptRecoveryPollingFixed
