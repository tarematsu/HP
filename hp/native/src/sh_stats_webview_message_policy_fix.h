#pragma once

#include "sh_auth_completion_message_policy_fix.h"
#include "stationhead_native_stats.h"

namespace hp {
namespace stationhead_stats_webview_message_policy {

inline ComPtr<ICoreWebView2WebMessageReceivedEventHandler>
WrapStationheadStatsWebMessageHandler(
    ICoreWebView2WebMessageReceivedEventHandler* handler) noexcept {
  if (!handler) return {};
  ComPtr<ICoreWebView2WebMessageReceivedEventHandler> inner = handler;
  return Callback<ICoreWebView2WebMessageReceivedEventHandler>(
      [inner = std::move(inner)](
          ICoreWebView2* sender,
          ICoreWebView2WebMessageReceivedEventArgs* args) noexcept -> HRESULT {
        if (!inner || !sender || !args) return S_OK;

        LPWSTR messageRaw = nullptr;
        if (SUCCEEDED(args->get_WebMessageAsJson(&messageRaw)) && messageRaw) {
          const std::wstring_view message(messageRaw);
          const bool consumed = PublishStationheadNativeStatsMessage(message);
          CoTaskMemFree(messageRaw);
          if (consumed) return S_OK;
        } else if (messageRaw) {
          CoTaskMemFree(messageRaw);
        }

        return stationhead_webview_policy::InvokeEventNoexcept(
            inner, sender, args);
      });
}

}  // namespace stationhead_stats_webview_message_policy
}  // namespace hp

// Preserve the existing exact-origin and Spotify-completion gates. The only new
// behavior is to consume a validated stationhead-play-stats object into the
// renderer store before the legacy generation-aware handler sees it.
#undef add_WebMessageReceived
#define add_WebMessageReceived(handler, token)                                  \
  add_WebMessageReceived(                                                       \
      ::hp::stationhead_webview_policy::WrapStationheadWebMessageHandler(       \
          ::hp::stationhead_auth_completion_message_policy::                    \
              WrapStationheadAuthCompletionMessageHandler(                      \
                  ::hp::stationhead_stats_webview_message_policy::              \
                      WrapStationheadStatsWebMessageHandler((handler)).Get())    \
                  .Get())                                                       \
          .Get(),                                                               \
      (token))
