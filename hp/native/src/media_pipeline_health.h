#pragma once
#include "common.h"

namespace hp {

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

inline std::wstring MediaPipelineErrorParameters(
    ICoreWebView2DevToolsProtocolEventReceivedEventArgs* args) {
  if (!args) return L"unknown media pipeline error";
  LPWSTR raw = nullptr;
  if (FAILED(args->get_ParameterObjectAsJson(&raw)) || !raw) {
    return L"unknown media pipeline error";
  }
  std::wstring value(raw);
  CoTaskMemFree(raw);
  constexpr size_t kMaximumDiagnosticCharacters = 1'024;
  if (value.size() > kMaximumDiagnosticCharacters) {
    value.resize(kMaximumDiagnosticCharacters);
    value += L"...";
  }
  return value;
}

}  // namespace hp
