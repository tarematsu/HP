// Trusted WebView2 pointer input for media-panel controls.
// Coordinates are CSS pixels relative to the WebView viewport, so this works
// even when the dashboard HWND is hidden by power-saving mode.
std::wstring NativeMediaTrustedMouseParams(
    const wchar_t* type, LONG x, LONG y, bool pressed) {
  std::wstring params = L"{\"type\":\"";
  params += type;
  params += L"\",\"x\":" + std::to_wstring(x) +
            L",\"y\":" + std::to_wstring(y);
  if (pressed) {
    params += L",\"button\":\"left\",\"buttons\":1,\"clickCount\":1";
  } else if (std::wstring_view(type) == L"mouseReleased") {
    params += L",\"button\":\"left\",\"buttons\":0,\"clickCount\":1";
  }
  params += L"}";
  return params;
}

void NativeMediaDispatchTrustedClick(
    ICoreWebView2* webview, LONG x, LONG y) noexcept {
  if (!webview) return;
  ComPtr<ICoreWebView2> view = webview;
  const std::wstring moved =
      NativeMediaTrustedMouseParams(L"mouseMoved", x, y, false);
  view->CallDevToolsProtocolMethod(
      L"Input.dispatchMouseEvent", moved.c_str(), nullptr);
  const std::wstring pressed =
      NativeMediaTrustedMouseParams(L"mousePressed", x, y, true);
  view->CallDevToolsProtocolMethod(
      L"Input.dispatchMouseEvent", pressed.c_str(),
      Callback<ICoreWebView2CallDevToolsProtocolMethodCompletedHandler>(
          [view, x, y](HRESULT result, LPCWSTR) -> HRESULT {
            if (FAILED(result)) return S_OK;
            const std::wstring released =
                NativeMediaTrustedMouseParams(L"mouseReleased", x, y, false);
            view->CallDevToolsProtocolMethod(
                L"Input.dispatchMouseEvent", released.c_str(), nullptr);
            return S_OK;
          }).Get());
}
