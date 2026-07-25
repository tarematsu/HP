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

// The refined login detector owns a recurring five-second timeout. Its original
// pagehide gate stopped work but still re-armed the timeout forever, retaining an
// obsolete document after navigation/BFCache transitions. Patch the generated
// runtime script so pagehide cancels the timer, every entry point rejects an
// inactive document, and pageshow explicitly resumes one timer.
inline std::wstring StationheadAutoplayScriptLifecycleFixed(
    const wchar_t* globalName,
    const wchar_t* messagePrefix) {
  std::wstring script =
      StationheadAutoplayScriptRuntimeFixed(globalName, messagePrefix);

  static constexpr std::wstring_view kTimerDeclaration = LR"JS(  const nativeTimeout = window.setTimeout.bind(window);
)JS";
  static constexpr std::wstring_view kTimerDeclarationFixed = LR"JS(  const nativeTimeout = window.setTimeout.bind(window);
  const nativeClearTimeout = window.clearTimeout.bind(window);
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

  const bool timerDeclarationReplaced = ReplaceStationheadRuntimeFragment(
      script, kTimerDeclaration, kTimerDeclarationFixed);
  const bool scanReplaced =
      ReplaceStationheadRuntimeFragment(script, kScan, kScanFixed);
  const bool scheduleReplaced =
      ReplaceStationheadRuntimeFragment(script, kSchedule, kScheduleFixed);
  const bool lifecycleReplaced = ReplaceStationheadRuntimeFragment(
      script, kPageLifecycle, kPageLifecycleFixed);

  // Static source tests pin every marker. Keeping the booleans observable here
  // also prevents an optimizer warning while preserving the last known-good
  // script if an upstream Stationhead policy changes before its test is updated.
  (void)timerDeclarationReplaced;
  (void)scanReplaced;
  (void)scheduleReplaced;
  (void)lifecycleReplaced;
  return script;
}

}  // namespace hp

#undef StationheadAutoplayScript
#define StationheadAutoplayScript StationheadAutoplayScriptLifecycleFixed
