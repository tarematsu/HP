#pragma once

#include "common.h"

namespace hp {

// Applies the browser surface shared by Stationhead, Spotify, and YouTube.
// Script and web-message access remain configurable because native playback
// automation uses them. Autofill stays enabled so each persistent WebView2
// profile can remember sign-in and form input.
inline void ApplyMediaWebViewFeaturePolicy(
    ICoreWebView2* webview, bool webMessagesEnabled) noexcept {
  if (!webview) return;

  ComPtr<ICoreWebView2Settings> settings;
  if (FAILED(webview->get_Settings(&settings)) || !settings) return;

  settings->put_IsScriptEnabled(TRUE);
  settings->put_IsWebMessageEnabled(webMessagesEnabled ? TRUE : FALSE);
  settings->put_AreDefaultScriptDialogsEnabled(FALSE);
  settings->put_AreDefaultContextMenusEnabled(FALSE);
  settings->put_AreDevToolsEnabled(FALSE);
  settings->put_IsStatusBarEnabled(FALSE);
  settings->put_AreHostObjectsAllowed(FALSE);
  settings->put_IsZoomControlEnabled(FALSE);
  settings->put_IsBuiltInErrorPageEnabled(FALSE);

  ComPtr<ICoreWebView2Settings3> settings3;
  if (SUCCEEDED(settings.As(&settings3)) && settings3) {
    settings3->put_AreBrowserAcceleratorKeysEnabled(FALSE);
  }

  ComPtr<ICoreWebView2Settings4> settings4;
  if (SUCCEEDED(settings.As(&settings4)) && settings4) {
    settings4->put_IsPasswordAutosaveEnabled(TRUE);
    settings4->put_IsGeneralAutofillEnabled(TRUE);
  }

  ComPtr<ICoreWebView2Settings5> settings5;
  if (SUCCEEDED(settings.As(&settings5)) && settings5) {
    settings5->put_IsPinchZoomEnabled(FALSE);
  }

  ComPtr<ICoreWebView2Settings6> settings6;
  if (SUCCEEDED(settings.As(&settings6)) && settings6) {
    settings6->put_IsSwipeNavigationEnabled(FALSE);
  }
}

}  // namespace hp
