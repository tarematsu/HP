#pragma once

#include "sh_start_button_locator_policy.h"
#include "sh_webview_event_policy.h"

namespace hp::stationhead_onboarding_click_policy {

inline bool TrustedStationheadMessage(
    ICoreWebView2* sender,
    ICoreWebView2WebMessageReceivedEventArgs* args) noexcept {
  if (!sender || !args) return false;
  LPWSTR messageSource = nullptr;
  LPWSTR currentSource = nullptr;
  const HRESULT messageSourceResult = args->get_Source(&messageSource);
  const HRESULT currentSourceResult = sender->get_Source(&currentSource);
  const bool trusted = SUCCEEDED(messageSourceResult) && messageSource &&
      SUCCEEDED(currentSourceResult) && currentSource &&
      stationhead_webview_policy::SameTrustedMessageOrigin(
          messageSource, currentSource);
  if (messageSource) CoTaskMemFree(messageSource);
  if (currentSource) CoTaskMemFree(currentSource);
  return trusted;
}

inline bool StartVisibleMessage(
    ICoreWebView2WebMessageReceivedEventArgs* args) noexcept {
  if (!args) return false;
  LPWSTR raw = nullptr;
  const HRESULT result = args->TryGetWebMessageAsString(&raw);
  if (FAILED(result) || !raw) return false;
  const std::wstring_view message(raw);
  const bool matches = message.ends_with(L"-start-visible");
  CoTaskMemFree(raw);
  return matches;
}

inline void DispatchTrustedMouseClick(
    ICoreWebView2* webview, double x, double y) noexcept {
  if (!webview) return;
  try {
    std::wostringstream pressed;
    pressed << std::fixed << std::setprecision(2)
            << L"{\"type\":\"mousePressed\",\"x\":" << x
            << L",\"y\":" << y
            << L",\"button\":\"left\",\"buttons\":1,\"clickCount\":1}";
    ComPtr<ICoreWebView2> view = webview;
    view->CallDevToolsProtocolMethod(
        L"Input.dispatchMouseEvent", pressed.str().c_str(),
        Callback<ICoreWebView2CallDevToolsProtocolMethodCompletedHandler>(
            [view, x, y](HRESULT pressedResult, LPCWSTR) -> HRESULT {
              if (FAILED(pressedResult) || !view) return S_OK;
              try {
                std::wostringstream released;
                released << std::fixed << std::setprecision(2)
                         << L"{\"type\":\"mouseReleased\",\"x\":" << x
                         << L",\"y\":" << y
                         << L",\"button\":\"left\",\"buttons\":0,\"clickCount\":1}";
                view->CallDevToolsProtocolMethod(
                    L"Input.dispatchMouseEvent", released.str().c_str(), nullptr);
              } catch (...) {
              }
              return S_OK;
            }).Get());
  } catch (...) {
  }
}

inline void AttemptTrustedOnboardingClick(ICoreWebView2* sender) noexcept {
  if (!sender) return;
  try {
    static const std::wstring locateScript = StationheadLocateStartButtonScript();
    ComPtr<ICoreWebView2> view = sender;
    view->ExecuteScript(
        locateScript.c_str(),
        Callback<ICoreWebView2ExecuteScriptCompletedHandler>(
            [view](HRESULT result, LPCWSTR resultJson) -> HRESULT {
              if (FAILED(result) || !resultJson || !view) return S_OK;
              double x = 0.0;
              double y = 0.0;
              if (!ParseStationheadLocateButtonResult(resultJson, x, y)) {
                return S_OK;
              }
              DispatchTrustedMouseClick(view.Get(), x, y);
              return S_OK;
            }).Get());
  } catch (...) {
  }
}

inline ComPtr<ICoreWebView2WebMessageReceivedEventHandler>
WrapStationheadOnboardingWebMessageHandler(
    ICoreWebView2WebMessageReceivedEventHandler* handler) noexcept {
  if (!handler) return {};
  ComPtr<ICoreWebView2WebMessageReceivedEventHandler> trustedInner =
      stationhead_webview_policy::WrapStationheadWebMessageHandler(handler);
  return Callback<ICoreWebView2WebMessageReceivedEventHandler>(
      [trustedInner = std::move(trustedInner)](
          ICoreWebView2* sender,
          ICoreWebView2WebMessageReceivedEventArgs* args) noexcept -> HRESULT {
        if (!trustedInner || !sender || !args) return S_OK;
        if (TrustedStationheadMessage(sender, args) && StartVisibleMessage(args)) {
          // Do not route recoverable onboarding through
          // StationheadPlayer::AttemptNativeStartClick. That method intentionally
          // suppresses ordinary Start Listening work while native audio is still
          // present, but Connect/Reconnect Music/Spotify must remain clickable
          // even when an expired session is still producing audio. The locator
          // itself keeps the strict onboarding allowlist and rejects real login
          // or account controls.
          AttemptTrustedOnboardingClick(sender);
          return S_OK;
        }
        return trustedInner->Invoke(sender, args);
      });
}

}  // namespace hp::stationhead_onboarding_click_policy

#undef add_WebMessageReceived
#define add_WebMessageReceived(handler, token)                                \
  add_WebMessageReceived(                                                     \
      ::hp::stationhead_onboarding_click_policy::                             \
          WrapStationheadOnboardingWebMessageHandler((handler)).Get(),        \
      (token))
