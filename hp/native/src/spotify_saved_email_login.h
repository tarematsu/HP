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

inline bool IsSpotifyAuthSource(ICoreWebView2* webview) noexcept {
  if (!webview) return false;
  LPWSTR rawSource = nullptr;
  if (FAILED(webview->get_Source(&rawSource)) || !rawSource) return false;
  const std::wstring source(rawSource);
  CoTaskMemFree(rawSource);
  return StartsWithInsensitive(source, L"https://accounts.spotify.com/") ||
         StartsWithInsensitive(source, L"https://challenge.spotify.com/") ||
         StartsWithInsensitive(source, L"https://open.spotify.com/login");
}

inline bool ParsePoint(LPCWSTR json, double* x, double* y) noexcept {
  if (!json || !x || !y) return false;
  try {
    const std::wstring value(json);
    if (value.size() < 5 || value.front() != L'[') return false;
    const size_t comma = value.find(L',');
    const size_t close = value.find(
        L']', comma == std::wstring::npos ? 0 : comma + 1);
    if (comma == std::wstring::npos || close == std::wstring::npos) return false;
    const double parsedX = std::stod(value.substr(1, comma - 1));
    const double parsedY = std::stod(value.substr(comma + 1, close - comma - 1));
    if (!(parsedX >= 0.0 && parsedX <= 100000.0) ||
        !(parsedY >= 0.0 && parsedY <= 100000.0)) {
      return false;
    }
    *x = parsedX;
    *y = parsedY;
    return true;
  } catch (...) {
    return false;
  }
}

inline void ResetAttempt(ICoreWebView2* webview) noexcept {
  if (!webview) return;
  webview->ExecuteScript(
      L"try{window.__hpSpotifySavedEmailLoginAttempted=false;}catch(e){}",
      nullptr);
}

inline void ScheduleContinueClick(ICoreWebView2* webview) noexcept {
  if (!webview || !IsSpotifyAuthSource(webview)) return;
  static constexpr wchar_t kSubmitScript[] = LR"JS(
(() => {
  const findEmailInput = () => {
    const selectors = [
      'input[type="email"]',
      'input[autocomplete="username"]',
      'input[name="email"]',
      'input[id*="email" i]',
      'input[name*="email" i]'
    ];
    for (const selector of selectors) {
      const input = document.querySelector(selector);
      if (input && !input.disabled && input.getClientRects().length) return input;
    }
    return null;
  };
  const visible = (element) => {
    if (!element || element.disabled || element.getAttribute('aria-disabled') === 'true') return false;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
  };
  const clickContinue = () => {
    const input = findEmailInput();
    if (!input || !String(input.value || '').trim()) return false;
    const form = input.form;
    const scope = form || document;
    let button = scope.querySelector('button[type="submit"], input[type="submit"]');
    if (!visible(button)) {
      button = Array.from(scope.querySelectorAll('button,[role="button"]')).find((candidate) => {
        if (!visible(candidate)) return false;
        const label = String(candidate.innerText || candidate.textContent || candidate.getAttribute('aria-label') || '')
          .trim().toLowerCase();
        return label === 'continue' || label === 'next' || label === '続行' || label === '次へ';
      }) || null;
    }
    if (!button) return false;
    button.click();
    window.__hpSpotifySavedEmailLoginSubmitted = true;
    return true;
  };
  setTimeout(() => {
    if (clickContinue()) return;
    setTimeout(() => {
      if (!clickContinue()) window.__hpSpotifySavedEmailLoginAttempted = false;
    }, 350);
  }, 100);
  return true;
})()
)JS";
  webview->ExecuteScript(kSubmitScript, nullptr);
}

struct KeySequenceState final {
  ComPtr<ICoreWebView2> webview;
  size_t stage = 0;
};

inline void ContinueKeySequence(
    const std::shared_ptr<KeySequenceState>& state) noexcept {
  if (!state || !state->webview || !IsSpotifyAuthSource(state->webview.Get())) {
    return;
  }

  static constexpr const wchar_t* kEvents[] = {
      L"{\"type\":\"keyDown\",\"key\":\"ArrowDown\",\"code\":\"ArrowDown\",\"windowsVirtualKeyCode\":40,\"nativeVirtualKeyCode\":40}",
      L"{\"type\":\"keyUp\",\"key\":\"ArrowDown\",\"code\":\"ArrowDown\",\"windowsVirtualKeyCode\":40,\"nativeVirtualKeyCode\":40}",
      L"{\"type\":\"keyDown\",\"key\":\"Enter\",\"code\":\"Enter\",\"windowsVirtualKeyCode\":13,\"nativeVirtualKeyCode\":13}",
      L"{\"type\":\"keyUp\",\"key\":\"Enter\",\"code\":\"Enter\",\"windowsVirtualKeyCode\":13,\"nativeVirtualKeyCode\":13}",
  };

  if (state->stage >= std::size(kEvents)) {
    ScheduleContinueClick(state->webview.Get());
    return;
  }

  const wchar_t* parameters = kEvents[state->stage++];
  const HRESULT dispatched = state->webview->CallDevToolsProtocolMethod(
      L"Input.dispatchKeyEvent", parameters,
      Callback<ICoreWebView2CallDevToolsProtocolMethodCompletedHandler>(
          [state](HRESULT result, LPCWSTR) -> HRESULT {
            if (FAILED(result)) {
              ResetAttempt(state->webview.Get());
              return S_OK;
            }
            ContinueKeySequence(state);
            return S_OK;
          }).Get());
  if (FAILED(dispatched)) ResetAttempt(state->webview.Get());
}

inline void DispatchInputClick(
    ICoreWebView2* webview, double x, double y) noexcept {
  if (!webview || !IsSpotifyAuthSource(webview)) return;
  try {
    ComPtr<ICoreWebView2> view = webview;
    const std::wstring pressed =
        L"{\"type\":\"mousePressed\",\"x\":" + std::to_wstring(x) +
        L",\"y\":" + std::to_wstring(y) +
        L",\"button\":\"left\",\"buttons\":1,\"clickCount\":1}";
    const HRESULT press = view->CallDevToolsProtocolMethod(
        L"Input.dispatchMouseEvent", pressed.c_str(),
        Callback<ICoreWebView2CallDevToolsProtocolMethodCompletedHandler>(
            [view, x, y](HRESULT result, LPCWSTR) -> HRESULT {
              if (FAILED(result) || !IsSpotifyAuthSource(view.Get())) {
                ResetAttempt(view.Get());
                return S_OK;
              }
              const std::wstring released =
                  L"{\"type\":\"mouseReleased\",\"x\":" + std::to_wstring(x) +
                  L",\"y\":" + std::to_wstring(y) +
                  L",\"button\":\"left\",\"buttons\":0,\"clickCount\":1}";
              const HRESULT release = view->CallDevToolsProtocolMethod(
                  L"Input.dispatchMouseEvent", released.c_str(),
                  Callback<ICoreWebView2CallDevToolsProtocolMethodCompletedHandler>(
                      [view](HRESULT releasedResult, LPCWSTR) -> HRESULT {
                        if (FAILED(releasedResult) ||
                            !IsSpotifyAuthSource(view.Get())) {
                          ResetAttempt(view.Get());
                          return S_OK;
                        }
                        auto state = std::make_shared<KeySequenceState>();
                        state->webview = view;
                        ContinueKeySequence(state);
                        return S_OK;
                      }).Get());
              if (FAILED(release)) ResetAttempt(view.Get());
              return S_OK;
            }).Get());
    if (FAILED(press)) ResetAttempt(view.Get());
  } catch (...) {
    ResetAttempt(webview);
  }
}

}  // namespace spotify_saved_email_detail

inline void TrySpotifySavedEmailLogin(ICoreWebView2* webview) noexcept {
  if (!webview || !spotify_saved_email_detail::IsSpotifyAuthSource(webview)) return;
  static constexpr wchar_t kLocateEmailScript[] = LR"JS(
(() => {
  if (window.__hpSpotifySavedEmailLoginAttempted ||
      window.__hpSpotifySavedEmailLoginSubmitted) return null;
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
    if (candidate && !candidate.disabled && candidate.getClientRects().length) {
      input = candidate;
      break;
    }
  }
  if (!input) return null;
  const rect = input.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  if (!(rect.width > 0 && rect.height > 0) ||
      !Number.isFinite(x) || !Number.isFinite(y) ||
      x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) {
    return null;
  }
  window.__hpSpotifySavedEmailLoginAttempted = true;
  input.focus({preventScroll:true});
  return [x, y];
})()
)JS";

  try {
    ComPtr<ICoreWebView2> view = webview;
    const HRESULT started = view->ExecuteScript(
        kLocateEmailScript,
        Callback<ICoreWebView2ExecuteScriptCompletedHandler>(
            [view](HRESULT result, LPCWSTR json) -> HRESULT {
              double x = 0.0;
              double y = 0.0;
              if (SUCCEEDED(result) &&
                  spotify_saved_email_detail::ParsePoint(json, &x, &y) &&
                  spotify_saved_email_detail::IsSpotifyAuthSource(view.Get())) {
                spotify_saved_email_detail::DispatchInputClick(view.Get(), x, y);
              }
              return S_OK;
            }).Get());
    if (FAILED(started)) spotify_saved_email_detail::ResetAttempt(view.Get());
  } catch (...) {
  }
}

}  // namespace hp
