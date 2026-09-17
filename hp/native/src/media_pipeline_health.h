#pragma once
#include "common.h"

namespace hp {

inline constexpr ULONGLONG kMediaPipelineRebuildCooldownMs =
    5ULL * 60ULL * 1000ULL;
inline constexpr ULONGLONG kMediaKeyWaitProtectionMs = 20ULL * 1000ULL;
inline constexpr std::array<ULONGLONG, 3> kMediaNetworkRetryDelaysMs{
    2ULL * 1000ULL, 5ULL * 1000ULL, 15ULL * 1000ULL};

enum class MediaPipelineRecoveryKind : uint8_t {
  None = 0,
  Network = 1,
  KeyWait = 2,
  Rebuild = 3,
};

struct MediaPipelineClassification {
  MediaPipelineRecoveryKind kind = MediaPipelineRecoveryKind::None;
  std::wstring_view category = L"other";
};

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
      if (towlower(value[start + offset]) != towlower(token[offset])) {
        matches = false;
        break;
      }
    }
    if (matches) return true;
  }
  return false;
}

inline MediaPipelineClassification PreferMediaPipelineClassification(
    MediaPipelineClassification current,
    MediaPipelineClassification candidate) noexcept {
  if (static_cast<uint8_t>(candidate.kind) >
      static_cast<uint8_t>(current.kind)) {
    return candidate;
  }
  return current;
}

inline MediaPipelineClassification ClassifyMediaPipelineText(
    std::wstring_view value) noexcept {
  constexpr std::pair<std::wstring_view, std::wstring_view> kFatalTokens[] = {
      {L"pipeline_error_decode", L"decode"},
      {L"media_error_decode", L"decode"},
      {L"decoder_error", L"decode"},
      {L"decodererror", L"decode"},
      {L"demuxer_error", L"demux"},
      {L"demuxererror", L"demux"},
      {L"audio_renderer_error", L"renderer"},
      {L"renderer_error", L"renderer"},
      {L"renderererror", L"renderer"},
      {L"pipeline_error_initialization_failed", L"initialization"},
      {L"pipeline_error_could_not_render", L"renderer"},
      {L"pipeline_error_external_renderer_failed", L"renderer"},
      {L"pipeline_error_hardware_context_reset", L"renderer"},
      {L"pipeline_error_disconnected", L"renderer"},
      {L"demuxer_error_bitstream_conversion_failed", L"demux"},
      {L"pipeline_error_out_of_memory", L"memory"},
  };
  for (const auto& [token, category] : kFatalTokens) {
    if (MediaPipelineErrorContains(value, token)) {
      return {MediaPipelineRecoveryKind::Rebuild, category};
    }
  }

  constexpr std::wstring_view kKeyWaitTokens[] = {
      L"decrypt", L"cdm_error", L"cdmerror", L"key_system_error",
      L"keysystemerror", L"waiting_for_key", L"waitingforkey"};
  for (const std::wstring_view token : kKeyWaitTokens) {
    if (MediaPipelineErrorContains(value, token)) {
      return {MediaPipelineRecoveryKind::KeyWait, L"decrypt"};
    }
  }

  constexpr std::wstring_view kNetworkTokens[] = {
      L"pipeline_error_network", L"pipeline_error_read",
      L"network_error", L"networkerror"};
  for (const std::wstring_view token : kNetworkTokens) {
    if (MediaPipelineErrorContains(value, token)) {
      return {MediaPipelineRecoveryKind::Network, L"network"};
    }
  }

  if (MediaPipelineErrorContains(value, L"abort")) {
    return {MediaPipelineRecoveryKind::None, L"aborted"};
  }
  return {};
}

inline MediaPipelineClassification ClassifyPipelineStatusCode(
    int code) noexcept {
  // Chromium media/base/pipeline_status.h. Interpret these numeric values only
  // when errorType/data identify the code as a PipelineStatus family; other
  // PlayerError types own independent numeric code spaces.
  switch (code) {
    case 2:   // PIPELINE_ERROR_NETWORK
    case 9:   // PIPELINE_ERROR_READ
    case 18:  // CHUNK_DEMUXER_ERROR_EOS_STATUS_NETWORK_ERROR
      return {MediaPipelineRecoveryKind::Network, L"network"};
    case 4:   // deprecated PIPELINE_ERROR_DECRYPT, still seen on older runtimes
      return {MediaPipelineRecoveryKind::KeyWait, L"decrypt"};
    case 3:   // PIPELINE_ERROR_DECODE
    case 6:   // PIPELINE_ERROR_INITIALIZATION_FAILED
    case 8:   // PIPELINE_ERROR_COULD_NOT_RENDER
    case 12:  // DEMUXER_ERROR_COULD_NOT_OPEN
    case 13:  // DEMUXER_ERROR_COULD_NOT_PARSE
    case 14:  // DEMUXER_ERROR_NO_SUPPORTED_STREAMS
    case 15:  // DECODER_ERROR_NOT_SUPPORTED
    case 16:  // CHUNK_DEMUXER_ERROR_APPEND_FAILED
    case 17:  // CHUNK_DEMUXER_ERROR_EOS_STATUS_DECODE_ERROR
    case 19:  // AUDIO_RENDERER_ERROR
    case 21:  // PIPELINE_ERROR_EXTERNAL_RENDERER_FAILED
    case 23:  // PIPELINE_ERROR_HARDWARE_CONTEXT_RESET
    case 24:  // PIPELINE_ERROR_DISCONNECTED
    case 25:  // DEMUXER_ERROR_BITSTREAM_CONVERSION_FAILED
    case 26:  // PIPELINE_ERROR_OUT_OF_MEMORY
      return {MediaPipelineRecoveryKind::Rebuild, L"pipeline"};
    default:
      return {};
  }
}

inline MediaPipelineClassification ClassifyMediaPipelineErrorObject(
    const winrt::Windows::Data::Json::JsonObject& error) noexcept {
  using namespace winrt::Windows::Data::Json;
  try {
    MediaPipelineClassification result;
    std::wstring errorType;
    std::wstring dataText;

    if (error.HasKey(L"errorType")) {
      const IJsonValue typeValue = error.GetNamedValue(L"errorType");
      if (typeValue && typeValue.ValueType() == JsonValueType::String) {
        errorType = typeValue.GetString().c_str();
        result = PreferMediaPipelineClassification(
            result, ClassifyMediaPipelineText(errorType));
      }
    }

    if (error.HasKey(L"data")) {
      const IJsonValue dataValue = error.GetNamedValue(L"data");
      if (dataValue) {
        dataText = dataValue.Stringify().c_str();
        result = PreferMediaPipelineClassification(
            result, ClassifyMediaPipelineText(dataText));
      }
    }

    const bool pipelineStatusCode =
        MediaPipelineErrorContains(errorType, L"pipeline") ||
        MediaPipelineErrorContains(errorType, L"pipeline_status") ||
        MediaPipelineErrorContains(dataText, L"pipelinestatus") ||
        MediaPipelineErrorContains(dataText, L"pipeline_status");
    if (pipelineStatusCode && error.HasKey(L"code")) {
      const IJsonValue codeValue = error.GetNamedValue(L"code");
      if (codeValue && codeValue.ValueType() == JsonValueType::Number) {
        result = PreferMediaPipelineClassification(
            result,
            ClassifyPipelineStatusCode(static_cast<int>(codeValue.GetNumber())));
      }
    }

    if (error.HasKey(L"cause")) {
      const IJsonValue causeValue = error.GetNamedValue(L"cause");
      if (causeValue && causeValue.ValueType() == JsonValueType::Array) {
        const JsonArray causes = causeValue.GetArray();
        for (uint32_t index = 0; index < causes.Size(); ++index) {
          const IJsonValue cause = causes.GetAt(index);
          if (!cause || cause.ValueType() != JsonValueType::Object) continue;
          result = PreferMediaPipelineClassification(
              result, ClassifyMediaPipelineErrorObject(cause.GetObject()));
          if (result.kind == MediaPipelineRecoveryKind::Rebuild) break;
        }
      }
    }
    return result;
  } catch (...) {
    return {};
  }
}

inline MediaPipelineClassification ClassifyMediaPipelineErrors(
    std::wstring_view parameters) noexcept {
  using namespace winrt::Windows::Data::Json;
  try {
    const JsonObject root = JsonObject::Parse(parameters);
    if (!root.HasKey(L"errors")) {
      return ClassifyMediaPipelineText(parameters);
    }
    const IJsonValue errorsValue = root.GetNamedValue(L"errors");
    if (!errorsValue || errorsValue.ValueType() != JsonValueType::Array) {
      return ClassifyMediaPipelineText(parameters);
    }

    MediaPipelineClassification result;
    const JsonArray errors = errorsValue.GetArray();
    for (uint32_t index = 0; index < errors.Size(); ++index) {
      const IJsonValue item = errors.GetAt(index);
      if (!item || item.ValueType() != JsonValueType::Object) continue;
      result = PreferMediaPipelineClassification(
          result, ClassifyMediaPipelineErrorObject(item.GetObject()));
      // Rebuild is the highest-priority action, so no later batched error can
      // change the decision.
      if (result.kind == MediaPipelineRecoveryKind::Rebuild) break;
    }
    return result;
  } catch (...) {
    // Retain a bounded compatibility path for older/unexpected CDP payloads,
    // but still apply the same fatal > DRM > network priority.
    return ClassifyMediaPipelineText(parameters);
  }
}

inline bool MediaPipelineErrorRequiresRebuild(
    std::wstring_view parameters) noexcept {
  const MediaPipelineRecoveryKind kind =
      ClassifyMediaPipelineErrors(parameters).kind;
  return kind == MediaPipelineRecoveryKind::Rebuild ||
      kind == MediaPipelineRecoveryKind::KeyWait;
}

inline bool MediaPipelineErrorIsNetwork(
    std::wstring_view parameters) noexcept {
  return ClassifyMediaPipelineErrors(parameters).kind ==
      MediaPipelineRecoveryKind::Network;
}

inline bool MediaPipelineErrorIsKeyWaitRelated(
    std::wstring_view parameters) noexcept {
  return ClassifyMediaPipelineErrors(parameters).kind ==
      MediaPipelineRecoveryKind::KeyWait;
}

inline std::wstring_view MediaPipelineErrorCategory(
    std::wstring_view parameters) noexcept {
  return ClassifyMediaPipelineErrors(parameters).category;
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
