#pragma once

#include "common.h"

namespace hp::stationhead_leaderboard_diagnostics {

inline constexpr int kDiagnosticSchema = 2;
inline constexpr UINT kWakeMessage = WM_APP + 31;

struct Snapshot {
  int schema = kDiagnosticSchema;
  std::string stage = "bootstrap";
  std::string lastSuccessStage = "bootstrap";
  std::string lastError = "none";
  int64_t lastTransitionAt = 0;
  int64_t lastFailureAt = 0;
  bool started = false;
  bool ticked = false;
};

inline std::mutex& StateMutex() {
  static std::mutex mutex;
  return mutex;
}

inline Snapshot& State() {
  static Snapshot state;
  return state;
}

inline void WakeCloud() noexcept {
  if (HWND window = FindWindowW(L"HomePanelNativeWindow", nullptr)) {
    PostMessageW(window, kWakeMessage, 0, 0);
  }
}

inline void Mark(std::string_view stage, bool started = false,
                 bool ticked = false) {
  bool changed = false;
  {
    std::lock_guard lock(StateMutex());
    Snapshot& state = State();
    const std::string next(stage);
    if (state.stage != next || (started && !state.started) ||
        (ticked && !state.ticked)) {
      state.stage = next;
      state.lastSuccessStage = next;
      state.lastError = "none";
      state.lastTransitionAt = UnixMillis();
      state.started = state.started || started;
      state.ticked = state.ticked || ticked;
      changed = true;
    }
  }
  if (changed) WakeCloud();
}

inline void MarkFailure(std::string_view error) {
  {
    std::lock_guard lock(StateMutex());
    Snapshot& state = State();
    state.stage = "failed";
    state.lastError = std::string(error);
    state.lastTransitionAt = UnixMillis();
    state.lastFailureAt = state.lastTransitionAt;
  }
  WakeCloud();
}

inline Snapshot Read() {
  std::lock_guard lock(StateMutex());
  return State();
}

inline const char* ErrorCategory(std::wstring_view reason) noexcept {
  if (reason.starts_with(L"capture-timeout")) return "capture_timeout";
  if (reason.starts_with(L"environment-create-failed")) return "environment_create";
  if (reason.starts_with(L"controller-create-start-failed")) return "controller_start";
  if (reason.starts_with(L"controller-create-failed")) return "controller_create";
  if (reason.starts_with(L"webview-unavailable")) return "webview_unavailable";
  if (reason.starts_with(L"navigation-handler-failed")) return "navigation_handler";
  if (reason.starts_with(L"navigation-failed")) return "navigation_failed";
  if (reason.starts_with(L"navigate-failed")) return "navigate_start";
  if (reason.starts_with(L"snapshot-execute-failed")) return "snapshot_execute";
  if (reason.starts_with(L"snapshot-start-failed")) return "snapshot_start";
  if (reason.starts_with(L"snapshot-parse-failed")) return "snapshot_parse";
  if (reason.starts_with(L"spool-write-failed")) return "spool_write";
  return "other";
}

}  // namespace hp::stationhead_leaderboard_diagnostics
