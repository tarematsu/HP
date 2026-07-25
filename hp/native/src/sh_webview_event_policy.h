#pragma once
#include "common.h"

namespace hp {
namespace stationhead_webview_policy {

inline constexpr wchar_t FoldAscii(wchar_t value) noexcept {
  return value >= L'A' && value <= L'Z' ? value + (L'a' - L'A') : value;
}

inline constexpr bool EqualsAsciiInsensitive(
    std::wstring_view left, std::wstring_view right) noexcept {
  if (left.size() != right.size()) return false;
  for (size_t index = 0; index < left.size(); ++index) {
    if (FoldAscii(left[index]) != FoldAscii(right[index])) return false;
  }
  return true;
}

inline constexpr bool HostMatchesDomain(
    std::wstring_view host, std::wstring_view domain) noexcept {
  while (!host.empty() && host.back() == L'.') host.remove_suffix(1);
  if (EqualsAsciiInsensitive(host, domain)) return true;
  if (host.size() <= domain.size() ||
      host[host.size() - domain.size() - 1] != L'.') {
    return false;
  }
  return EqualsAsciiInsensitive(host.substr(host.size() - domain.size()), domain);
}

inline constexpr bool IsStationheadHost(std::wstring_view host) noexcept {
  return HostMatchesDomain(host, L"stationhead.com");
}

inline constexpr bool IsSpotifyHost(std::wstring_view host) noexcept {
  return HostMatchesDomain(host, L"spotify.com");
}

static_assert(IsStationheadHost(L"stationhead.com"));
static_assert(IsStationheadHost(L"www.stationhead.com"));
static_assert(!IsStationheadHost(L"stationhead.com.example.net"));
static_assert(!IsStationheadHost(L"evilstationhead.com"));
static_assert(IsSpotifyHost(L"accounts.spotify.com"));
static_assert(!IsSpotifyHost(L"spotify.com.example.net"));

struct WebOriginView {
  std::wstring_view host;
  INTERNET_PORT port = 0;
};

inline bool CrackHttpsOrigin(LPCWSTR uri, WebOriginView& origin) noexcept {
  if (!uri || !*uri) return false;
  URL_COMPONENTS components{sizeof(components)};
  components.dwSchemeLength = static_cast<DWORD>(-1);
  components.dwHostNameLength = static_cast<DWORD>(-1);
  if (!WinHttpCrackUrl(uri, 0, 0, &components) ||
      components.nScheme != INTERNET_SCHEME_HTTPS ||
      !components.lpszHostName || components.dwHostNameLength == 0) {
    return false;
  }
  origin.host = std::wstring_view(
      components.lpszHostName, components.dwHostNameLength);
  origin.port = components.nPort == 0 ? INTERNET_DEFAULT_HTTPS_PORT
                                      : components.nPort;
  return origin.port == INTERNET_DEFAULT_HTTPS_PORT;
}

inline bool IsTrustedMessageUri(LPCWSTR uri, WebOriginView& origin) noexcept {
  if (!CrackHttpsOrigin(uri, origin)) return false;
  return IsStationheadHost(origin.host) || IsSpotifyHost(origin.host);
}

inline bool IsTrustedPlaybackUri(LPCWSTR uri) noexcept {
  WebOriginView origin;
  return CrackHttpsOrigin(uri, origin) && IsStationheadHost(origin.host);
}

inline bool SameTrustedMessageOrigin(LPCWSTR left, LPCWSTR right) noexcept {
  WebOriginView leftOrigin;
  WebOriginView rightOrigin;
  if (!IsTrustedMessageUri(left, leftOrigin) ||
      !IsTrustedMessageUri(right, rightOrigin)) {
    return false;
  }
  return leftOrigin.port == rightOrigin.port &&
      EqualsAsciiInsensitive(leftOrigin.host, rightOrigin.host);
}

inline bool IsAboutBlank(LPCWSTR uri) noexcept {
  return uri && EqualsAsciiInsensitive(uri, L"about:blank");
}

inline bool IsTrustedPopupTarget(LPCWSTR uri) noexcept {
  if (IsAboutBlank(uri)) return true;
  WebOriginView origin;
  return IsTrustedMessageUri(uri, origin);
}

template <typename Handler, typename Sender, typename Args>
inline HRESULT InvokeEventNoexcept(
    const ComPtr<Handler>& handler, Sender* sender, Args* args) noexcept {
  if (!handler) return S_OK;
  try {
    return handler->Invoke(sender, args);
  } catch (...) {
    // Event callbacks allocate strings, parse JSON, update status and log. A
    // single allocation or parser exception must never unwind through WebView2.
    return E_FAIL;
  }
}

inline ComPtr<ICoreWebView2WebMessageReceivedEventHandler>
WrapStationheadWebMessageHandler(
    ICoreWebView2WebMessageReceivedEventHandler* handler) noexcept {
  if (!handler) return {};
  ComPtr<ICoreWebView2WebMessageReceivedEventHandler> inner = handler;
  return Callback<ICoreWebView2WebMessageReceivedEventHandler>(
      [inner = std::move(inner)](
          ICoreWebView2* sender,
          ICoreWebView2WebMessageReceivedEventArgs* args) noexcept -> HRESULT {
        if (!inner || !sender || !args) return S_OK;

        LPWSTR messageSource = nullptr;
        LPWSTR currentSource = nullptr;
        const HRESULT messageSourceResult = args->get_Source(&messageSource);
        const HRESULT currentSourceResult = sender->get_Source(&currentSource);
        const bool trusted = SUCCEEDED(messageSourceResult) && messageSource &&
            SUCCEEDED(currentSourceResult) && currentSource &&
            SameTrustedMessageOrigin(messageSource, currentSource);
        if (messageSource) CoTaskMemFree(messageSource);
        if (currentSource) CoTaskMemFree(currentSource);
        if (!trusted) return S_OK;

        return InvokeEventNoexcept(inner, sender, args);
      });
}

inline ComPtr<ICoreWebView2NewWindowRequestedEventHandler>
WrapStationheadNewWindowHandler(
    ICoreWebView2NewWindowRequestedEventHandler* handler) noexcept {
  if (!handler) return {};
  ComPtr<ICoreWebView2NewWindowRequestedEventHandler> inner = handler;
  return Callback<ICoreWebView2NewWindowRequestedEventHandler>(
      [inner = std::move(inner)](
          ICoreWebView2* sender,
          ICoreWebView2NewWindowRequestedEventArgs* args) noexcept -> HRESULT {
        if (!inner || !sender || !args) return S_OK;

        LPWSTR currentSource = nullptr;
        LPWSTR targetUri = nullptr;
        const HRESULT currentSourceResult = sender->get_Source(&currentSource);
        const HRESULT targetResult = args->get_Uri(&targetUri);
        const bool trusted = SUCCEEDED(currentSourceResult) && currentSource &&
            IsTrustedPlaybackUri(currentSource) && SUCCEEDED(targetResult) &&
            targetUri && IsTrustedPopupTarget(targetUri);
        if (currentSource) CoTaskMemFree(currentSource);
        if (targetUri) CoTaskMemFree(targetUri);
        if (!trusted) {
          // The kiosk must not create an authentication controller for an
          // unrelated popup or let the system browser escape the surface.
          args->put_Handled(TRUE);
          return S_OK;
        }

        const HRESULT result = InvokeEventNoexcept(inner, sender, args);
        if (FAILED(result)) args->put_Handled(TRUE);
        return result;
      });
}

inline ComPtr<ICoreWebView2NavigationStartingEventHandler>
WrapStationheadNavigationStartingHandler(
    ICoreWebView2NavigationStartingEventHandler* handler) noexcept {
  if (!handler) return {};
  ComPtr<ICoreWebView2NavigationStartingEventHandler> inner = handler;
  return Callback<ICoreWebView2NavigationStartingEventHandler>(
      [inner = std::move(inner)](
          ICoreWebView2* sender,
          ICoreWebView2NavigationStartingEventArgs* args) noexcept -> HRESULT {
        const HRESULT result = InvokeEventNoexcept(inner, sender, args);
        // Continuing a navigation after its state-tracking callback failed can
        // leave navigationInFlight_ permanently inconsistent.
        if (FAILED(result) && args) args->put_Cancel(TRUE);
        return result;
      });
}

inline ComPtr<ICoreWebView2NavigationCompletedEventHandler>
WrapStationheadNavigationCompletedHandler(
    ICoreWebView2NavigationCompletedEventHandler* handler) noexcept {
  if (!handler) return {};
  ComPtr<ICoreWebView2NavigationCompletedEventHandler> inner = handler;
  return Callback<ICoreWebView2NavigationCompletedEventHandler>(
      [inner = std::move(inner)](
          ICoreWebView2* sender,
          ICoreWebView2NavigationCompletedEventArgs* args) noexcept -> HRESULT {
        return InvokeEventNoexcept(inner, sender, args);
      });
}

inline ComPtr<ICoreWebView2ProcessFailedEventHandler>
WrapStationheadProcessFailedHandler(
    ICoreWebView2ProcessFailedEventHandler* handler) noexcept {
  if (!handler) return {};
  ComPtr<ICoreWebView2ProcessFailedEventHandler> inner = handler;
  return Callback<ICoreWebView2ProcessFailedEventHandler>(
      [inner = std::move(inner)](
          ICoreWebView2* sender,
          ICoreWebView2ProcessFailedEventArgs* args) noexcept -> HRESULT {
        return InvokeEventNoexcept(inner, sender, args);
      });
}

inline ComPtr<ICoreWebView2WindowCloseRequestedEventHandler>
WrapStationheadWindowCloseHandler(
    ICoreWebView2WindowCloseRequestedEventHandler* handler) noexcept {
  if (!handler) return {};
  ComPtr<ICoreWebView2WindowCloseRequestedEventHandler> inner = handler;
  return Callback<ICoreWebView2WindowCloseRequestedEventHandler>(
      [inner = std::move(inner)](
          ICoreWebView2* sender, IUnknown* args) noexcept -> HRESULT {
        return InvokeEventNoexcept(inner, sender, args);
      });
}

inline ComPtr<ICoreWebView2IsDocumentPlayingAudioChangedEventHandler>
WrapStationheadAudioChangedHandler(
    ICoreWebView2IsDocumentPlayingAudioChangedEventHandler* handler) noexcept {
  if (!handler) return {};
  ComPtr<ICoreWebView2IsDocumentPlayingAudioChangedEventHandler> inner = handler;
  return Callback<ICoreWebView2IsDocumentPlayingAudioChangedEventHandler>(
      [inner = std::move(inner)](
          ICoreWebView2* sender, IUnknown* args) noexcept -> HRESULT {
        return InvokeEventNoexcept(inner, sender, args);
      });
}

inline ComPtr<ICoreWebView2WebResourceRequestedEventHandler>
WrapStationheadWebResourceRequestedHandler(
    ICoreWebView2WebResourceRequestedEventHandler* handler) noexcept {
  if (!handler) return {};
  ComPtr<ICoreWebView2WebResourceRequestedEventHandler> inner = handler;
  return Callback<ICoreWebView2WebResourceRequestedEventHandler>(
      [inner = std::move(inner)](
          ICoreWebView2* sender,
          ICoreWebView2WebResourceRequestedEventArgs* args) noexcept -> HRESULT {
        return InvokeEventNoexcept(inner, sender, args);
      });
}

}  // namespace stationhead_webview_policy
}  // namespace hp

// WebView2 event registration is centralized in Stationhead code. Wrapping the
// registration token preserves the existing handlers while enforcing origin,
// popup and exception-containment policy before player state can be mutated.
#define add_WebMessageReceived(handler, token)                                \
  add_WebMessageReceived(                                                     \
      ::hp::stationhead_webview_policy::                                      \
          WrapStationheadWebMessageHandler((handler)).Get(),                  \
      (token))

#define add_NewWindowRequested(handler, token)                                \
  add_NewWindowRequested(                                                     \
      ::hp::stationhead_webview_policy::                                      \
          WrapStationheadNewWindowHandler((handler)).Get(),                   \
      (token))

#define add_NavigationStarting(handler, token)                                \
  add_NavigationStarting(                                                     \
      ::hp::stationhead_webview_policy::                                      \
          WrapStationheadNavigationStartingHandler((handler)).Get(),          \
      (token))

#define add_NavigationCompleted(handler, token)                               \
  add_NavigationCompleted(                                                    \
      ::hp::stationhead_webview_policy::                                      \
          WrapStationheadNavigationCompletedHandler((handler)).Get(),         \
      (token))

#define add_ProcessFailed(handler, token)                                     \
  add_ProcessFailed(                                                          \
      ::hp::stationhead_webview_policy::                                      \
          WrapStationheadProcessFailedHandler((handler)).Get(),               \
      (token))

#define add_WindowCloseRequested(handler, token)                              \
  add_WindowCloseRequested(                                                   \
      ::hp::stationhead_webview_policy::                                      \
          WrapStationheadWindowCloseHandler((handler)).Get(),                 \
      (token))

#define add_IsDocumentPlayingAudioChanged(handler, token)                     \
  add_IsDocumentPlayingAudioChanged(                                          \
      ::hp::stationhead_webview_policy::                                      \
          WrapStationheadAudioChangedHandler((handler)).Get(),                \
      (token))

#define add_WebResourceRequested(handler, token)                              \
  add_WebResourceRequested(                                                   \
      ::hp::stationhead_webview_policy::                                      \
          WrapStationheadWebResourceRequestedHandler((handler)).Get(),        \
      (token))
