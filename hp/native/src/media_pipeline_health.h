#pragma once
#include "common.h"

namespace hp {

inline constexpr ULONGLONG kMediaPipelineRebuildCooldownMs =
    5ULL * 60ULL * 1000ULL;
inline constexpr ULONGLONG kMediaKeyWaitProtectionMs = 20ULL * 1000ULL;
inline constexpr std::array<ULONGLONG, 3> kMediaNetworkRetryDelaysMs{
    2ULL * 1000ULL, 5ULL * 1000ULL, 15ULL * 1000ULL};

inline HRESULT SubscribeMediaPipelineErrors(
    ICoreWebView2* webview,
    ICoreWebView2DevToolsProtocolEventReceivedEventHandler* handler,
    ComPtr<ICoreWebView2DevToolsProtocolEventReceiver>& receiver,
    EventRegistrationToken& token) noexcept {
  receiver.Reset();
  token = {};
  if (!webview || !handler) return E_POINTER;

  HRESULT result = webview->GetDevToolsProtocolEventReceiver(
      L"Media.playerErrorsRaised", &receiver);
  if (FAILED(result) || !receiver) {
    receiver.Reset();
    return FAILED(result) ? result : E_NOINTERFACE;
  }

  result = receiver->add_DevToolsProtocolEventReceived(handler, &token);
  if (FAILED(result)) {
    token = {};
    receiver.Reset();
    return result;
  }

  result = webview->CallDevToolsProtocolMethod(L"Media.enable", L"{}", nullptr);
  if (FAILED(result)) {
    receiver->remove_DevToolsProtocolEventReceived(token);
    token = {};
    receiver.Reset();
  }
  return result;
}

inline void UnsubscribeMediaPipelineErrors(
    ComPtr<ICoreWebView2DevToolsProtocolEventReceiver>& receiver,
    EventRegistrationToken& token) noexcept {
  if (receiver && token.value != 0) {
    receiver->remove_DevToolsProtocolEventReceived(token);
  }
  token = {};
  receiver.Reset();
}

inline bool MediaPipelineErrorContains(
    std::wstring_view value, std::wstring_view token) noexcept {
  if (token.empty() || value.size() < token.size()) return false;
  for (size_t start = 0; start + token.size() <= value.size(); ++start) {
    bool matches = true;
    for (size_t offset = 0; offset < token.size(); ++offset) {
      if (towlower(value[start + offset]) != token[offset]) {
        matches = false;
        break;
      }
    }
    if (matches) return true;
  }
  return false;
}

inline bool MediaPipelineErrorRequiresRebuild(
    std::wstring_view parameters) noexcept {
  // A player error can also describe a cancelled request or a temporary
  // network failure. Those already have bounded page-level recovery and must
  // not tear down a healthy decoder. Rebuild only failures that identify the
  // local decode/decrypt/demux/audio-render pipeline.
  constexpr std::wstring_view kFatalTokens[] = {
      L"pipeline_error_decode",
      L"media_error_decode",
      L"decoder_error",
      L"decrypt",
      L"cdm_error",
      L"key_system_error",
      L"demuxer_error",
      L"audio_renderer_error",
      L"pipeline_error_initialization_failed",
      L"pipeline_error_could_not_render",
  };
  for (const std::wstring_view token : kFatalTokens) {
    if (MediaPipelineErrorContains(parameters, token)) return true;
  }
  return false;
}

inline bool MediaPipelineErrorIsNetwork(
    std::wstring_view parameters) noexcept {
  return MediaPipelineErrorContains(parameters, L"network") ||
      MediaPipelineErrorContains(parameters, L"pipeline_error_read");
}

inline bool MediaPipelineErrorIsKeyWaitRelated(
    std::wstring_view parameters) noexcept {
  return MediaPipelineErrorContains(parameters, L"decrypt") ||
      MediaPipelineErrorContains(parameters, L"cdm_error") ||
      MediaPipelineErrorContains(parameters, L"key_system_error");
}

inline std::wstring_view MediaPipelineErrorCategory(
    std::wstring_view parameters) noexcept {
  if (MediaPipelineErrorContains(parameters, L"decrypt")) return L"decrypt";
  if (MediaPipelineErrorContains(parameters, L"decode") ||
      MediaPipelineErrorContains(parameters, L"decoder")) {
    return L"decode";
  }
  if (MediaPipelineErrorContains(parameters, L"demux")) return L"demux";
  if (MediaPipelineErrorContains(parameters, L"renderer")) return L"renderer";
  if (MediaPipelineErrorContains(parameters, L"initialization")) {
    return L"initialization";
  }
  if (MediaPipelineErrorContains(parameters, L"network")) return L"network";
  if (MediaPipelineErrorContains(parameters, L"abort")) return L"aborted";
  return L"other";
}

inline std::wstring MediaPipelineErrorParameters(
    ICoreWebView2DevToolsProtocolEventReceivedEventArgs* args) {
  if (!args) return L"unknown media pipeline error";
  LPWSTR raw = nullptr;
  if (FAILED(args->get_ParameterObjectAsJson(&raw)) || !raw) {
    return L"unknown media pipeline error";
  }
  std::wstring value(raw);
  CoTaskMemFree(raw);
  // The payload is used only for local classification and is never logged.
  // Bound pathological protocol data without cutting ordinary error tokens.
  constexpr size_t kMaximumClassificationCharacters = 64 * 1024;
  if (value.size() > kMaximumClassificationCharacters) {
    value.resize(kMaximumClassificationCharacters);
  }
  return value;
}

}  // namespace hp
