#pragma once

#include "sh_recoverable_action_policy.h"
#include "sh_runtime_interaction_script.h"
#include "sh_runtime_onboarding_script.h"
#include "sh_runtime_blank_recovery_script.h"
#include "sh_runtime_lifecycle_script.h"

namespace hp {

inline void ReplaceStationheadRuntimeToken(
    std::wstring& script,
    std::wstring_view from,
    std::wstring_view to) {
  for (size_t at = script.find(from); at != std::wstring::npos;
       at = script.find(from, at + to.size())) {
    script.replace(at, from.size(), to);
  }
}

// Compose exactly one document-start IIFE. The source is split by C++ file
// responsibility only; there are no independent page runtimes or duplicate
// schedulers introduced by this composition.
inline std::wstring StationheadCompactRuntimeScript(
    const wchar_t* globalName,
    const wchar_t* messagePrefix) {
  const std::wstring_view interaction = StationheadRuntimeInteractionFragment();
  const std::wstring_view onboarding = StationheadRuntimeOnboardingFragment();
  const std::wstring_view recovery = StationheadRuntimeBlankRecoveryFragment();
  const std::wstring_view lifecycle = StationheadRuntimeLifecycleFragment();

  std::wstring script;
  script.reserve(
      interaction.size() + onboarding.size() + recovery.size() + lifecycle.size() + 3);
  script.append(interaction);
  script.push_back(L'\n');
  script.append(onboarding);
  script.push_back(L'\n');
  script.append(recovery);
  script.push_back(L'\n');
  script.append(lifecycle);

  const std::wstring_view guard =
      globalName ? std::wstring_view(globalName)
                 : std::wstring_view(L"__homepanelStationhead");
  const std::wstring_view prefix =
      messagePrefix ? std::wstring_view(messagePrefix)
                    : std::wstring_view(L"stationhead");
  ReplaceStationheadRuntimeToken(script, L"{{GLOBAL}}", guard);
  ReplaceStationheadRuntimeToken(script, L"{{PREFIX}}", prefix);
  InjectStationheadRecoverableActionPattern(script);
  return script;
}

// Compatibility only: sh_track_boundary_message_policy.h still contains an
// unused historical wrapper around the compact runtime. Its old bridge polls
// authentication state every second. Install the equivalent bridge here first,
// driven only by the existing auth-ready event, and set the historical guard so
// that wrapper returns before it can arm the recurring timer. The effective
// startup path still calls StationheadCompactRuntimeScript directly.
inline std::wstring StationheadAutoplayScriptRuntimeFixed(
    const wchar_t* globalName,
    const wchar_t* messagePrefix) {
  std::wstring script = StationheadCompactRuntimeScript(globalName, messagePrefix);
  script.append(LR"JS(
;
(() => {
  const host = String(location.hostname || '').toLowerCase();
  if ((host !== 'stationhead.com' && !host.ends_with?.('.stationhead.com')) ||
      window.top !== window || window.__homepanelStationheadInteractionBridge) {
    return;
  }
  const webview = window.chrome?.webview;
  if (!webview || typeof webview.postMessage !== 'function') return;
  window.__homepanelStationheadInteractionBridge = true;
  let lastReady = false;
  const publish = () => {
    const ready = window.__homepanelStationheadBlockingLoginVisible === false;
    if (!ready || lastReady) return;
    lastReady = true;
    try {
      webview.postMessage({
        type: 'stationhead-auth-ready',
        source: 'current-interaction-state'
      });
    } catch (_) {}
  };
  const reset = () => {
    if (window.__homepanelStationheadBlockingLoginVisible !== false) {
      lastReady = false;
    }
  };
  window.addEventListener('homepanel-stationhead-auth-ready', () => {
    reset();
    publish();
  }, true);
  window.addEventListener('pagehide', reset, true);
  publish();
})()
)JS");
  return script;
}

}  // namespace hp