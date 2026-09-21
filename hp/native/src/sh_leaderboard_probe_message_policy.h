#pragma once

#include "stationhead_leaderboard_probe_spool.h"

namespace hp {
namespace stationhead_leaderboard_probe_message_policy {

inline constexpr std::wstring_view kProbePrefix =
    L"stationhead-leaderboard-probe:";

inline bool IsTrustedStationheadSource(
    ICoreWebView2WebMessageReceivedEventArgs* args) noexcept {
  if (!args) return false;
  LPWSTR sourceRaw = nullptr;
  if (FAILED(args->get_Source(&sourceRaw)) || !sourceRaw) return false;
  stationhead_webview_policy::WebOriginView origin;
  const bool trusted =
      stationhead_webview_policy::CrackHttpsOrigin(sourceRaw, origin) &&
      stationhead_webview_policy::IsStationheadHost(origin.host);
  CoTaskMemFree(sourceRaw);
  return trusted;
}

inline bool CaptureProbeMessage(
    ICoreWebView2WebMessageReceivedEventArgs* args) noexcept {
  if (!args) return false;
  LPWSTR raw = nullptr;
  if (FAILED(args->TryGetWebMessageAsString(&raw)) || !raw) return false;
  const std::wstring message(raw);
  CoTaskMemFree(raw);
  if (!message.starts_with(kProbePrefix)) return false;

  // Consume probe-prefixed messages even when rejected so the ordinary
  // Stationhead parser never sees diagnostic JSON as a playback message.
  if (!IsTrustedStationheadSource(args)) return true;
  const std::wstring_view payload(message.data() + kProbePrefix.size(),
                                  message.size() - kProbePrefix.size());
  stationhead_leaderboard_probe_spool::Append(payload);
  return true;
}

inline ComPtr<ICoreWebView2WebMessageReceivedEventHandler>
WrapStationheadLeaderboardProbeMessageHandler(
    ICoreWebView2WebMessageReceivedEventHandler* handler) noexcept {
  if (!handler) return {};
  ComPtr<ICoreWebView2WebMessageReceivedEventHandler> inner = handler;
  return Callback<ICoreWebView2WebMessageReceivedEventHandler>(
      [inner = std::move(inner)](
          ICoreWebView2* sender,
          ICoreWebView2WebMessageReceivedEventArgs* args) noexcept -> HRESULT {
        if (!inner || !sender || !args) return S_OK;
        if (CaptureProbeMessage(args)) return S_OK;
        return stationhead_webview_policy::InvokeEventNoexcept(
            inner, sender, args);
      });
}

}  // namespace stationhead_leaderboard_probe_message_policy
}  // namespace hp
