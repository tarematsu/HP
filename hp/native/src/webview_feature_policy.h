#pragma once

#include "common.h"

namespace hp {

// Applies the browser surface shared by Stationhead, Spotify, and YouTube.
// Script and web-message access remain configurable because native playback
// automation uses them. Autofill stays enabled so each persistent WebView2
// profile can remember sign-in and form input.
inline void ApplyMediaWebViewFeaturePolicy(
    ICoreWebView2Controller* controller, ICoreWebView2* webview,
    bool webMessagesEnabled) noexcept {
  if (controller) {
    ComPtr<ICoreWebView2Controller> baseController = controller;
    ComPtr<ICoreWebView2Controller4> controller4;
    if (SUCCEEDED(baseController.As(&controller4)) && controller4) {
      controller4->put_AllowExternalDrop(FALSE);
    }
  }
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

  ComPtr<ICoreWebView2Settings7> settings7;
  if (SUCCEEDED(settings.As(&settings7)) && settings7) {
    const auto hiddenPdfItems = static_cast<COREWEBVIEW2_PDF_TOOLBAR_ITEMS>(
        COREWEBVIEW2_PDF_TOOLBAR_ITEMS_PRINT |
        COREWEBVIEW2_PDF_TOOLBAR_ITEMS_SAVE |
        COREWEBVIEW2_PDF_TOOLBAR_ITEMS_SAVE_AS |
        COREWEBVIEW2_PDF_TOOLBAR_ITEMS_BOOKMARKS |
        COREWEBVIEW2_PDF_TOOLBAR_ITEMS_FIT_PAGE |
        COREWEBVIEW2_PDF_TOOLBAR_ITEMS_PAGE_LAYOUT |
        COREWEBVIEW2_PDF_TOOLBAR_ITEMS_ROTATE |
        COREWEBVIEW2_PDF_TOOLBAR_ITEMS_SEARCH |
        COREWEBVIEW2_PDF_TOOLBAR_ITEMS_ZOOM_IN |
        COREWEBVIEW2_PDF_TOOLBAR_ITEMS_ZOOM_OUT |
        COREWEBVIEW2_PDF_TOOLBAR_ITEMS_PAGE_SELECTOR |
        COREWEBVIEW2_PDF_TOOLBAR_ITEMS_FULL_SCREEN |
        COREWEBVIEW2_PDF_TOOLBAR_ITEMS_MORE_SETTINGS);
    settings7->put_HiddenPdfToolbarItems(hiddenPdfItems);
  }

  EventRegistrationToken ignoredToken{};
  webview->add_PermissionRequested(
      Callback<ICoreWebView2PermissionRequestedEventHandler>(
          [](ICoreWebView2*, ICoreWebView2PermissionRequestedEventArgs* args)
              -> HRESULT {
            if (!args) return S_OK;
            COREWEBVIEW2_PERMISSION_KIND kind =
                COREWEBVIEW2_PERMISSION_KIND_UNKNOWN_PERMISSION;
            if (FAILED(args->get_PermissionKind(&kind))) return S_OK;
            switch (kind) {
              case COREWEBVIEW2_PERMISSION_KIND_MICROPHONE:
              case COREWEBVIEW2_PERMISSION_KIND_CAMERA:
              case COREWEBVIEW2_PERMISSION_KIND_GEOLOCATION:
              case COREWEBVIEW2_PERMISSION_KIND_NOTIFICATIONS:
              case COREWEBVIEW2_PERMISSION_KIND_OTHER_SENSORS:
                args->put_State(COREWEBVIEW2_PERMISSION_STATE_DENY);
                break;
              default:
                break;
            }
            return S_OK;
          })
          .Get(),
      &ignoredToken);

  ComPtr<ICoreWebView2> baseWebView = webview;
  ComPtr<ICoreWebView2_4> webview4;
  if (SUCCEEDED(baseWebView.As(&webview4)) && webview4) {
    webview4->add_DownloadStarting(
        Callback<ICoreWebView2DownloadStartingEventHandler>(
            [](ICoreWebView2*, ICoreWebView2DownloadStartingEventArgs* args)
                -> HRESULT {
              if (args) {
                args->put_Cancel(TRUE);
                args->put_Handled(TRUE);
              }
              return S_OK;
            })
            .Get(),
        &ignoredToken);
  }

  ComPtr<ICoreWebView2_18> webview18;
  if (SUCCEEDED(baseWebView.As(&webview18)) && webview18) {
    webview18->add_LaunchingExternalUriScheme(
        Callback<ICoreWebView2LaunchingExternalUriSchemeEventHandler>(
            [](ICoreWebView2*,
               ICoreWebView2LaunchingExternalUriSchemeEventArgs* args)
                -> HRESULT {
              if (args) args->put_Cancel(TRUE);
              return S_OK;
            })
            .Get(),
        &ignoredToken);
  }
}

}  // namespace hp
