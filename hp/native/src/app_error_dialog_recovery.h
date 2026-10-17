#pragma once

#include "common.h"

namespace hp {

// Separate restart reason from the regular three daily restarts. The media
// panel uses this flag to start directly with YouTube after error recovery.
inline bool IsErrorDialogRestartLaunch() noexcept {
  static const bool enabled = []() noexcept {
    int argc = 0;
    wchar_t** argv = CommandLineToArgvW(GetCommandLineW(), &argc);
    if (!argv) return false;
    bool found = false;
    for (int index = 1; index < argc; ++index) {
      if (_wcsicmp(argv[index], L"--error-restart") == 0) {
        found = true;
        break;
      }
    }
    LocalFree(argv);
    return found;
  }();
  return enabled;
}

// Only accept explicit fatal Windows dialog titles referring to this app or
// its Edge/WebView2 runtime. Browser page modals and ordinary confirmation
// dialogs never qualify. Input is already folded to lowercase.
inline bool IsHomePanelErrorDialogTitle(std::wstring_view title) noexcept {
  const auto has = [title](std::wstring_view word) noexcept {
    return title.find(word) != std::wstring_view::npos;
  };
  const bool relevantProcess =
      has(L"homepanel.exe") || has(L"msedgewebview2.exe") ||
      has(L"msedge.exe") || has(L"microsoft edge webview2");
  const bool fatalError =
      has(L"application error") || has(L"system error") ||
      has(L"アプリケーション エラー") || has(L"システム エラー") ||
      has(L"エラー") || has(L"has stopped working") ||
      has(L"動作を停止");
  return relevantProcess && fatalError;
}

inline std::wstring FindHomePanelErrorDialog() {
  struct Match {
    wchar_t title[512]{};
  } match;
  EnumWindows(
      [](HWND window, LPARAM parameter) noexcept -> BOOL {
        if (!IsWindowVisible(window)) return TRUE;
        wchar_t className[32]{};
        if (!GetClassNameW(window, className, _countof(className)) ||
            wcscmp(className, L"#32770") != 0) {
          return TRUE;
        }
        wchar_t title[512]{};
        const int size = GetWindowTextW(window, title, _countof(title));
        if (size <= 0) return TRUE;
        for (int index = 0; index < size; ++index) {
          title[index] = static_cast<wchar_t>(towlower(title[index]));
        }
        if (!IsHomePanelErrorDialogTitle(std::wstring_view(title, size))) {
          return TRUE;
        }
        auto* match = reinterpret_cast<Match*>(parameter);
        wcsncpy_s(match->title, title, _TRUNCATE);
        return FALSE;
      },
      reinterpret_cast<LPARAM>(&match));
  return match.title[0] ? std::wstring(match.title) : std::wstring();
}

}  // namespace hp
