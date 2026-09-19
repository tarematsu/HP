#pragma once

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
  return script;
}

// Compatibility only: sh_track_boundary_message_policy.h still contains an
// unused historical wrapper that names the old runtime entry point. Map that
// symbol to the compact runtime so the header can compile without restoring the
// retired polling/watchdog implementation. The effective startup path calls
// StationheadCompactRuntimeScript directly from sh_startup_script.h.
inline std::wstring StationheadAutoplayScriptRuntimeFixed(
    const wchar_t* globalName,
    const wchar_t* messagePrefix) {
  return StationheadCompactRuntimeScript(globalName, messagePrefix);
}

}  // namespace hp
