#pragma once

#include "common.h"

namespace hp {
namespace spotify_saved_email_detail {

inline bool StartsWithInsensitive(std::wstring_view value,
                                  std::wstring_view prefix) noexcept {
  if (value.size() < prefix.size()) return false;
  for (size_t i = 0; i < prefix.size(); ++i) {
    if (towlower(value[i]) != towlower(prefix[i])) return false;
  }
  return true;
}

inline bool IsSpotifyEmailLoginSource(ICoreWebView2* webview) noexcept {
  if (!webview) return false;
  LPWSTR rawSource = nullptr;
  if (FAILED(webview->get_Source(&rawSource)) || !rawSource) return false;
  const std::wstring source(rawSource);
  CoTaskMemFree(rawSource);
  return StartsWithInsensitive(source, L"https://accounts.spotify.com/") ||
         StartsWithInsensitive(source, L"https://open.spotify.com/login");
}

inline bool ParseActionPoint(
    LPCWSTR json, int* action, double* x, double* y) noexcept {
  if (!json || !action || !x || !y) return false;
  try {
    const std::wstring value(json);
    if (value.size() < 7 || value.front() != L'[') return false;
    const size_t comma1 = value.find(L',');
    const size_t comma2 = value.find(
        L',', comma1 == std::wstring::npos ? 0 : comma1 + 1);
    const size_t close = value.find(
        L']', comma2 == std::wstring::npos ? 0 : comma2 + 1);
    if (comma1 == std::wstring::npos || comma2 == std::wstring::npos ||
        close == std::wstring::npos) {
      return false;
    }
    const int parsedAction = std::stoi(value.substr(1, comma1 - 1));
    const double parsedX =
        std::stod(value.substr(comma1 + 1, comma2 - comma1 - 1));
    const double parsedY =
        std::stod(value.substr(comma2 + 1, close - comma2 - 1));
    if ((parsedAction != 1 && parsedAction != 2) ||
        !(parsedX >= 0.0 && parsedX <= 100000.0) ||
        !(parsedY >= 0.0 && parsedY <= 100000.0)) {
      return false;
    }
    *action = parsedAction;
    *x = parsedX;
    *y = parsedY;
    return true;
  } catch (...) {
    return false;
  }
}

struct KeySequenceState final {
  ComPtr<ICoreWebView2> webview;
  size_t stage = 0;
};

inline void ContinueSavedEmailKeySequence(
    const std::shared_ptr<KeySequenceState>& state) noexcept {
  if (!state || !state->webview ||
      !IsSpotifyEmailLoginSource(state->webview.Get())) {
    return;
  }

  static constexpr const wchar_t* kEvents[] = {
      L"{\"type\":\"keyDown\",\"key\":\"ArrowDown\",\"code\":\"ArrowDown\",\"windowsVirtualKeyCode\":40,\"nativeVirtualKeyCode\":40}",
      L"{\"type\":\"keyUp\",\"key\":\"ArrowDown\",\"code\":\"ArrowDown\",\"windowsVirtualKeyCode\":40,\"nativeVirtualKeyCode\":40}",
      L"{\"type\":\"keyDown\",\"key\":\"Enter\",\"code\":\"Enter\",\"windowsVirtualKeyCode\":13,\"nativeVirtualKeyCode\":13}",
      L"{\"type\":\"keyUp\",\"key\":\"Enter\",\"code\":\"Enter\",\"windowsVirtualKeyCode\":13,\"nativeVirtualKeyCode\":13}",
  };

  if (state->stage >= std::size(kEvents)) return;
  const wchar_t* parameters = kEvents[state->stage++];
  const HRESULT dispatched = state->webview->CallDevToolsProtocolMethod(
      L"Input.dispatchKeyEvent", parameters,
      Callback<ICoreWebView2CallDevToolsProtocolMethodCompletedHandler>(
          [state](HRESULT result, LPCWSTR) -> HRESULT {
            if (SUCCEEDED(result)) ContinueSavedEmailKeySequence(state);
            return S_OK;
          }).Get());
  if (FAILED(dispatched)) return;
}

inline void DispatchTrustedClick(
    ICoreWebView2* webview, double x, double y,
    bool chooseSavedEmail) noexcept {
  if (!webview || !IsSpotifyEmailLoginSource(webview)) return;
  try {
    ComPtr<ICoreWebView2> view = webview;
    const std::wstring moved =
        L"{\"type\":\"mouseMoved\",\"x\":" + std::to_wstring(x) +
        L",\"y\":" + std::to_wstring(y) + L"}";
    const HRESULT move = view->CallDevToolsProtocolMethod(
        L"Input.dispatchMouseEvent", moved.c_str(),
        Callback<ICoreWebView2CallDevToolsProtocolMethodCompletedHandler>(
            [view, x, y, chooseSavedEmail](HRESULT movedResult, LPCWSTR) -> HRESULT {
              if (FAILED(movedResult) ||
                  !IsSpotifyEmailLoginSource(view.Get())) {
                return S_OK;
              }
              const std::wstring pressed =
                  L"{\"type\":\"mousePressed\",\"x\":" +
                  std::to_wstring(x) + L",\"y\":" + std::to_wstring(y) +
                  L",\"button\":\"left\",\"buttons\":1,\"clickCount\":1}";
              const HRESULT press = view->CallDevToolsProtocolMethod(
                  L"Input.dispatchMouseEvent", pressed.c_str(),
                  Callback<ICoreWebView2CallDevToolsProtocolMethodCompletedHandler>(
                      [view, x, y, chooseSavedEmail](
                          HRESULT pressedResult, LPCWSTR) -> HRESULT {
                        if (FAILED(pressedResult) ||
                            !IsSpotifyEmailLoginSource(view.Get())) {
                          return S_OK;
                        }
                        const std::wstring released =
                            L"{\"type\":\"mouseReleased\",\"x\":" +
                            std::to_wstring(x) + L",\"y\":" +
                            std::to_wstring(y) +
                            L",\"button\":\"left\",\"buttons\":0,\"clickCount\":1}";
                        const HRESULT release = view->CallDevToolsProtocolMethod(
                            L"Input.dispatchMouseEvent", released.c_str(),
                            Callback<ICoreWebView2CallDevToolsProtocolMethodCompletedHandler>(
                                [view, chooseSavedEmail](
                                    HRESULT releasedResult, LPCWSTR) -> HRESULT {
                                  if (SUCCEEDED(releasedResult) &&
                                      chooseSavedEmail &&
                                      IsSpotifyEmailLoginSource(view.Get())) {
                                    auto state =
                                        std::make_shared<KeySequenceState>();
                                    state->webview = view;
                                    ContinueSavedEmailKeySequence(state);
                                  }
                                  return S_OK;
                                }).Get());
                        (void)release;
                        return S_OK;
                      }).Get());
              (void)press;
              return S_OK;
            }).Get());
    (void)move;
  } catch (...) {
  }
}

}  // namespace spotify_saved_email_detail

inline void TrySpotifySavedEmailLogin(ICoreWebView2* webview) noexcept {
  if (!webview ||
      !spotify_saved_email_detail::IsSpotifyEmailLoginSource(webview)) {
    return;
  }

  static constexpr wchar_t kLocateActionScript[] = LR"JS(
(() => {
  const visible = (element) => {
    if (!element || element.disabled || element.getAttribute('aria-disabled') === 'true') return false;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 &&
      style.visibility !== 'hidden' && style.display !== 'none';
  };
  const center = (element) => {
    if (!visible(element)) return null;
    const rect = element.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    if (!Number.isFinite(x) || !Number.isFinite(y) ||
        x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) {
      return null;
    }
    return [x, y];
  };
  const selectors = [
    'input[type="email"]',
    'input[autocomplete="username"]',
    'input[name="email"]',
    'input[id*="email" i]',
    'input[name*="email" i]'
  ];
  let input = null;
  for (const selector of selectors) {
    const candidate = document.querySelector(selector);
    if (visible(candidate)) {
      input = candidate;
      break;
    }
  }
  if (!input) return null;

  if (String(input.value || '').trim()) {
    const now = performance.now();
    if (Number(window.__hpSpotifySavedEmailContinuePendingUntil || 0) > now) {
      return null;
    }
    const scope = input.form || document;
    let button = scope.querySelector('button[type="submit"], input[type="submit"]');
    if (!visible(button)) {
      button = Array.from(scope.querySelectorAll('button,[role="button"]')).find((candidate) => {
        if (!visible(candidate)) return false;
        const label = String(
          candidate.innerText || candidate.textContent ||
          candidate.getAttribute('aria-label') || candidate.getAttribute('title') || ''
        ).trim().toLowerCase();
        return label === 'continue' || label === 'next' ||
          label === '続行' || label === '次へ';
      }) || null;
    }
    const point = center(button);
    if (!point) return null;
    window.__hpSpotifySavedEmailContinuePendingUntil = now + 1500;
    return [2, point[0], point[1]];
  }

  const point = center(input);
  if (!point) return null;
  input.focus({preventScroll:true});
  return [1, point[0], point[1]];
})()
)JS";

  try {
    ComPtr<ICoreWebView2> view = webview;
    const HRESULT started = view->ExecuteScript(
        kLocateActionScript,
        Callback<ICoreWebView2ExecuteScriptCompletedHandler>(
            [view](HRESULT result, LPCWSTR json) -> HRESULT {
              int action = 0;
              double x = 0.0;
              double y = 0.0;
              if (SUCCEEDED(result) &&
                  spotify_saved_email_detail::ParseActionPoint(
                      json, &action, &x, &y) &&
                  spotify_saved_email_detail::IsSpotifyEmailLoginSource(
                      view.Get())) {
                spotify_saved_email_detail::DispatchTrustedClick(
                    view.Get(), x, y, action == 1);
              }
              return S_OK;
            }).Get());
    (void)started;
  } catch (...) {
  }
}

}  // namespace hp
