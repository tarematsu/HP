#pragma once
#include "sh_auth_navigation_policy_fix.h"
#include "stationhead_permanent_resource_mode.h"

namespace hp {

// Service-worker and shared-worker requests are environment-wide. WebView2
// requires those source filters on one CoreWebView per environment; otherwise
// the same request is delivered to multiple native handlers. The restored
// single Stationhead instance owns the ozeki profile (spotify-v2-6).
inline bool StationheadOwnsWorkerRequestFilters(ICoreWebView2* webview) {
  if (!webview) return false;
  ComPtr<ICoreWebView2> base = webview;
  ComPtr<ICoreWebView2_13> profileView;
  if (FAILED(base.As(&profileView)) || !profileView) return true;
  ComPtr<ICoreWebView2Profile> profile;
  if (FAILED(profileView->get_Profile(&profile)) || !profile) return true;
  LPWSTR profileNameRaw = nullptr;
  if (FAILED(profile->get_ProfileName(&profileNameRaw)) || !profileNameRaw) {
    return true;
  }
  const bool ownsWorkerFilters =
      _wcsicmp(profileNameRaw, L"spotify-v2-6") == 0;
  CoTaskMemFree(profileNameRaw);
  return ownsWorkerFilters;
}

inline void AddStationheadResourceFilter(
    ICoreWebView2* webview,
    ICoreWebView2_22* sourceAwareWebView,
    COREWEBVIEW2_WEB_RESOURCE_CONTEXT context,
    COREWEBVIEW2_WEB_RESOURCE_REQUEST_SOURCE_KINDS sourceKinds) {
  HRESULT result = E_NOINTERFACE;
  if (sourceAwareWebView) {
    result = sourceAwareWebView->AddWebResourceRequestedFilterWithRequestSourceKinds(
        L"*", context, sourceKinds);
  }
  if (FAILED(result) && webview) {
    webview->AddWebResourceRequestedFilter(L"*", context);
  }
}

// Images and downloadable fonts are disabled once at shared-UDF environment
// creation. Keep only Stationhead-specific request boundaries here so every
// intercepted request has a playback or telemetry reason to cross into native.

}  // namespace hp

