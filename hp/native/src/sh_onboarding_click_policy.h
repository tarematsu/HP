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

inline std::wstring StationheadLocateKeepStreamingScript() {
  static constexpr wchar_t kScript[] = LR"JS(
(() => {
  const host = String(location.hostname || '').toLowerCase();
  if ((host !== 'stationhead.com' && !host.endsWith('.stationhead.com')) ||
      window.top !== window || !document.body) return null;

  const keepStreamingPattern = /^keep\s+streaming$/i;
  const candidateSelector =
    "button,[role='button'],a,input[type='button'],input[type='submit']," +
    "div,span,p,[tabindex],[aria-label],[data-testid]";
  const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
  const labelsOf = element => [
    element?.getAttribute?.('aria-label'),
    element?.getAttribute?.('data-testid'),
    element?.getAttribute?.('title'),
    element?.getAttribute?.('alt'),
    element?.getAttribute?.('value'),
    element?.innerText,
    element?.textContent,
  ].map(normalize).filter(Boolean);
  const rendered = element => {
    if (!(element instanceof HTMLElement) || !element.isConnected ||
        element.disabled || element.getAttribute('aria-hidden') === 'true' ||
        element.getAttribute('aria-disabled') === 'true') return false;
    const rect = element.getBoundingClientRect();
    if (!rect || rect.width <= 2 || rect.height <= 2) return false;
    const style = getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden' &&
      Number(style.opacity || 1) > 0 && style.pointerEvents !== 'none';
  };
  const clickableTargetFor = element => {
    for (let current = element, depth = 0;
         current && current !== document.body && depth < 8;
         current = current.parentElement, depth += 1) {
      if (!rendered(current)) continue;
      const tag = String(current.tagName || '').toLowerCase();
      const role = String(current.getAttribute?.('role') || '').toLowerCase();
      const style = getComputedStyle(current);
      if (tag === 'button' || tag === 'a' || tag === 'input' ||
          role === 'button' || current.getAttribute?.('tabindex') !== null ||
          typeof current.onclick === 'function' || style.cursor === 'pointer') {
        return current;
      }
    }
    return rendered(element) ? element : null;
  };
  const pointOf = element => {
    if (!element || !rendered(element)) return null;
    let rect = element.getBoundingClientRect();
    let x = rect.left + rect.width / 2;
    let y = rect.top + rect.height / 2;
    const inViewport = () =>
      rect.right > 0 && rect.bottom > 0 && rect.left < innerWidth &&
      rect.top < innerHeight && x >= 0 && y >= 0 && x < innerWidth &&
      y < innerHeight;
    if (!inViewport()) {
      try {
        element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'auto' });
      } catch (_) {
        try { element.scrollIntoView(); } catch (_) {}
      }
      rect = element.getBoundingClientRect();
      x = rect.left + rect.width / 2;
      y = rect.top + rect.height / 2;
    }
    if (!inViewport()) return null;
    const hit = document.elementFromPoint(x, y);
    if (!hit || (hit !== element && !element.contains(hit))) return null;
    return { x, y };
  };

  for (const element of document.querySelectorAll(candidateSelector)) {
    if (!rendered(element) ||
        !labelsOf(element).some(label => keepStreamingPattern.test(label))) {
      continue;
    }
    const point = pointOf(clickableTargetFor(element));
    if (point) return point;
  }
  return null;
})()
)JS";
  return kScript;
}

inline bool DispatchLocatedTrustedAction(
    ICoreWebView2* view, LPCWSTR resultJson) noexcept {
  if (!view || !resultJson) return false;
  double x = 0.0;
  double y = 0.0;
  if (!ParseStationheadLocateButtonResult(resultJson, x, y)) return false;
  DispatchTrustedMouseClick(view, x, y);
  return true;
}

inline void AttemptTrustedOnboardingFallbackClick(
    ComPtr<ICoreWebView2> view) noexcept {
  if (!view) return;
  try {
    static const std::wstring locateScript = StationheadLocateStartButtonScript();
    view->ExecuteScript(
        locateScript.c_str(),
        Callback<ICoreWebView2ExecuteScriptCompletedHandler>(
            [view](HRESULT result, LPCWSTR resultJson) -> HRESULT {
              if (FAILED(result) || !view) return S_OK;
              DispatchLocatedTrustedAction(view.Get(), resultJson);
              return S_OK;
            }).Get());
  } catch (...) {
  }
}

inline void AttemptTrustedOnboardingClick(ICoreWebView2* sender) noexcept {
  if (!sender) return;
  try {
    static const std::wstring keepStreamingScript =
        StationheadLocateKeepStreamingScript();
    ComPtr<ICoreWebView2> view = sender;
    view->ExecuteScript(
        keepStreamingScript.c_str(),
        Callback<ICoreWebView2ExecuteScriptCompletedHandler>(
            [view](HRESULT result, LPCWSTR resultJson) -> HRESULT {
              if (SUCCEEDED(result) && view &&
                  DispatchLocatedTrustedAction(view.Get(), resultJson)) {
                return S_OK;
              }
              AttemptTrustedOnboardingFallbackClick(view);
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
          // Recoverable onboarding and Keep Streaming continuation prompts use
          // trusted CDP input directly. This path deliberately has no dependency
          // on foreground-window ownership or native audio state, so an external
          // updater dialog cannot suspend the click.
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
