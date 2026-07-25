#pragma once

namespace hp {

inline bool ReplaceStationheadRuntimeFragment(
    std::wstring& script,
    std::wstring_view from,
    std::wstring_view to) {
  const size_t at = script.find(from);
  if (at == std::wstring::npos) return false;
  script.replace(at, from.size(), to);
  return true;
}

// Stationhead composes several document-lifetime policies into one startup
// script. Patch their generated source at the final policy layer so every timer
// and MutationObserver stops on pagehide/BFCache entry and is rebuilt only when
// that exact document receives pageshow again.
inline std::wstring StationheadAutoplayScriptLifecycleFixed(
    const wchar_t* globalName,
    const wchar_t* messagePrefix) {
  std::wstring script =
      StationheadAutoplayScriptRuntimeFixed(globalName, messagePrefix);

  static constexpr std::wstring_view kUiLifecycle = LR"JS(  document.addEventListener('visibilitychange', () => {
    if (pageHidden()) pauseObserver();
    else resumeObserver();
  });
  if (document.documentElement) start();
)JS";
  static constexpr std::wstring_view kUiLifecycleFixed = LR"JS(  document.addEventListener('visibilitychange', () => {
    if (pageHidden()) pauseObserver();
    else resumeObserver();
  });
  window.addEventListener('pagehide', pauseObserver, true);
  window.addEventListener('pageshow', resumeObserver, true);
  if (document.documentElement) start();
)JS";

  static constexpr std::wstring_view kBaseState = LR"JS(  let observer = null;
  let scanQueued = false;
  let scanTimer = 0;
  let lastSignalAt = 0;
)JS";
  static constexpr std::wstring_view kBaseStateFixed = LR"JS(  let observer = null;
  let scanQueued = false;
  let scanTimer = 0;
  let pageActive = true;
  let lastSignalAt = 0;
)JS";
  static constexpr std::wstring_view kBaseScan = LR"JS(  const scan = () => {
    scanQueued = false;
    scanTimer = 0;
    const ready = document.readyState !== 'loading' && !!document.body;
)JS";
  static constexpr std::wstring_view kBaseScanFixed = LR"JS(  const scan = () => {
    scanQueued = false;
    scanTimer = 0;
    if (!pageActive) return;
    const ready = document.readyState !== 'loading' && !!document.body;
)JS";
  static constexpr std::wstring_view kBaseSchedule = LR"JS(  const schedule = (delay = 100) => {
    if (scanQueued) return;
)JS";
  static constexpr std::wstring_view kBaseScheduleFixed = LR"JS(  const schedule = (delay = 100) => {
    if (!pageActive || scanQueued) return;
)JS";
  static constexpr std::wstring_view kBaseTail = LR"JS(  document.addEventListener('DOMContentLoaded', schedule, { once: true });
  window.addEventListener('load', schedule, { once: true });
  schedule();
  nativeTimeout(schedule, 15000);
)JS";
  static constexpr std::wstring_view kBaseTailFixed = LR"JS(  document.addEventListener('DOMContentLoaded', schedule, { once: true });
  window.addEventListener('load', schedule, { once: true });
  schedule();
  const delayedScanTimer = nativeTimeout(schedule, 15000);
  window.addEventListener('pagehide', () => {
    pageActive = false;
    scanQueued = false;
    if (scanTimer) {
      nativeClearTimeout(scanTimer);
      scanTimer = 0;
    }
    nativeClearTimeout(delayedScanTimer);
    observer?.disconnect?.();
    observer = null;
  }, true);
  window.addEventListener('pageshow', () => {
    pageActive = true;
    attachObserver();
    schedule(0);
  }, true);
)JS";

  // Include the following normalize declaration in the marker. Earlier composed
  // IIFEs also declare nativeTimeout, but only the refined login IIFE places
  // normalize immediately after it.
  static constexpr std::wstring_view kTimerDeclaration = LR"JS(  const nativeTimeout = window.setTimeout.bind(window);
  const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
)JS";
  static constexpr std::wstring_view kTimerDeclarationFixed = LR"JS(  const nativeTimeout = window.setTimeout.bind(window);
  const nativeClearTimeout = window.clearTimeout.bind(window);
  const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
)JS";
  static constexpr std::wstring_view kScan = LR"JS(  const scan = () => {
    baseScan();
    updateBlockingLogin();
    flushPendingAuthReady();
  };
)JS";
  static constexpr std::wstring_view kScanFixed = LR"JS(  const scan = () => {
    if (!pageActive) return;
    baseScan();
    updateBlockingLogin();
    flushPendingAuthReady();
  };
)JS";
  static constexpr std::wstring_view kSchedule = LR"JS(  const schedule = () => {
    if (timer) return;
    timer = nativeTimeout(() => {
      timer = 0;
      if (pageActive) {
        if (playing()) baseScan();
        updateBlockingLogin();
        flushPendingAuthReady();
      }
      schedule();
    }, 5000);
  };
)JS";
  static constexpr std::wstring_view kScheduleFixed = LR"JS(  const schedule = () => {
    if (!pageActive || timer) return;
    timer = nativeTimeout(() => {
      timer = 0;
      if (!pageActive) return;
      if (playing()) baseScan();
      updateBlockingLogin();
      flushPendingAuthReady();
      schedule();
    }, 5000);
  };
)JS";
  static constexpr std::wstring_view kPageLifecycle = LR"JS(  window.addEventListener('pagehide', () => { pageActive = false; }, true);
  window.addEventListener('pageshow', () => {
    pageActive = true;
    scan();
  }, true);
)JS";
  static constexpr std::wstring_view kPageLifecycleFixed = LR"JS(  window.addEventListener('pagehide', () => {
    pageActive = false;
    if (timer) {
      nativeClearTimeout(timer);
      timer = 0;
    }
  }, true);
  window.addEventListener('pageshow', () => {
    pageActive = true;
    scan();
    schedule();
  }, true);
)JS";

  const bool uiLifecycleReplaced = ReplaceStationheadRuntimeFragment(
      script, kUiLifecycle, kUiLifecycleFixed);
  const bool baseStateReplaced = ReplaceStationheadRuntimeFragment(
      script, kBaseState, kBaseStateFixed);
  const bool baseScanReplaced = ReplaceStationheadRuntimeFragment(
      script, kBaseScan, kBaseScanFixed);
  const bool baseScheduleReplaced = ReplaceStationheadRuntimeFragment(
      script, kBaseSchedule, kBaseScheduleFixed);
  const bool baseTailReplaced = ReplaceStationheadRuntimeFragment(
      script, kBaseTail, kBaseTailFixed);
  const bool timerDeclarationReplaced = ReplaceStationheadRuntimeFragment(
      script, kTimerDeclaration, kTimerDeclarationFixed);
  const bool scanReplaced =
      ReplaceStationheadRuntimeFragment(script, kScan, kScanFixed);
  const bool scheduleReplaced =
      ReplaceStationheadRuntimeFragment(script, kSchedule, kScheduleFixed);
  const bool lifecycleReplaced = ReplaceStationheadRuntimeFragment(
      script, kPageLifecycle, kPageLifecycleFixed);

  // Static source tests pin every marker. Keeping the booleans observable here
  // also prevents optimizer warnings while preserving the last known-good
  // generated script if an upstream policy changes before its test is updated.
  (void)uiLifecycleReplaced;
  (void)baseStateReplaced;
  (void)baseScanReplaced;
  (void)baseScheduleReplaced;
  (void)baseTailReplaced;
  (void)timerDeclarationReplaced;
  (void)scanReplaced;
  (void)scheduleReplaced;
  (void)lifecycleReplaced;
  return script;
}

}  // namespace hp

#undef StationheadAutoplayScript
#define StationheadAutoplayScript StationheadAutoplayScriptLifecycleFixed
