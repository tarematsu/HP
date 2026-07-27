#pragma once

namespace hp {
namespace stationhead_auth_completion_message_policy {

inline bool IsStationheadAuthCompletionMessage(
    ICoreWebView2WebMessageReceivedEventArgs* args) noexcept {
  if (!args) return false;
  LPWSTR messageRaw = nullptr;
  if (FAILED(args->get_WebMessageAsJson(&messageRaw)) || !messageRaw) {
    return false;
  }
  const std::wstring messageJson = messageRaw;
  CoTaskMemFree(messageRaw);

  bool completion = false;
  try {
    const auto message =
        winrt::Windows::Data::Json::JsonObject::Parse(messageJson);
    const std::wstring type =
        message.GetNamedString(L"type", L"").c_str();
    completion = type == L"spotify-connected" || type == L"spotify-error";
  } catch (...) {
    // String messages and unrelated malformed page messages retain the existing
    // handler behavior. Only recognized auth-completion objects are gated here.
  }
  return completion;
}

inline bool HasStationheadAuthCompletionSource(
    ICoreWebView2WebMessageReceivedEventArgs* args) noexcept {
  if (!args) return false;
  LPWSTR sourceRaw = nullptr;
  if (FAILED(args->get_Source(&sourceRaw)) || !sourceRaw) return false;
  stationhead_webview_policy::WebOriginView origin;
  const bool stationhead =
      stationhead_webview_policy::CrackHttpsOrigin(sourceRaw, origin) &&
      stationhead_webview_policy::IsStationheadHost(origin.host);
  CoTaskMemFree(sourceRaw);
  return stationhead;
}

inline ComPtr<ICoreWebView2WebMessageReceivedEventHandler>
WrapStationheadAuthCompletionMessageHandler(
    ICoreWebView2WebMessageReceivedEventHandler* handler) noexcept {
  if (!handler) return {};
  ComPtr<ICoreWebView2WebMessageReceivedEventHandler> inner = handler;
  return Callback<ICoreWebView2WebMessageReceivedEventHandler>(
      [inner = std::move(inner)](
          ICoreWebView2* sender,
          ICoreWebView2WebMessageReceivedEventArgs* args) noexcept -> HRESULT {
        if (!inner || !sender || !args) return S_OK;
        if (IsStationheadAuthCompletionMessage(args) &&
            !HasStationheadAuthCompletionSource(args)) {
          // Spotify owns credential entry and consent, but Stationhead owns the
          // authoritative connected/error result. Keep the OAuth surface alive
          // until a same-origin Stationhead document reports that result.
          return S_OK;
        }
        return stationhead_webview_policy::InvokeEventNoexcept(
            inner, sender, args);
      });
}

}  // namespace stationhead_auth_completion_message_policy
}  // namespace hp

// Preserve the existing exact-current-origin gate as the outer boundary, then
// apply the stricter Stationhead-only rule to the two terminal auth messages.
#undef add_WebMessageReceived
#define add_WebMessageReceived(handler, token)                                  \
  add_WebMessageReceived(                                                       \
      ::hp::stationhead_webview_policy::WrapStationheadWebMessageHandler(       \
          ::hp::stationhead_auth_completion_message_policy::                    \
              WrapStationheadAuthCompletionMessageHandler((handler)).Get())     \
          .Get(),                                                               \
      (token))
