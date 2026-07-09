// Part of sh_player.cpp's translation unit (see the #include at the end of that
// file). WebView2 setup/teardown for the primary Stationhead player and its
// Spotify auth popup: settings, event handlers, resource blocking, the injected
// kStationheadAppPatch, and controller cleanup.
#include "sh.h"
#include "sh_shared.h"
#include <winrt/Windows.Data.Json.h>

namespace hp {

void StationheadPlayer::ConfigureWebView() {
  // Primary Stationhead keeps the default profile, but its surface follows the
  // same startup rule as B: start hidden/behind unless App is holding the shared
  // A/B startup preview or an explicit login/auth flow is active.
  SetStartupBounds();
  ComPtr<ICoreWebView2Controller2> controller2;
  if (SUCCEEDED(controller_.As(&controller2))) {
    COREWEBVIEW2_COLOR background{255, 7, 17, 28};
    controller2->put_DefaultBackgroundColor(background);
  }
  ComPtr<ICoreWebView2Settings> settings;
  webview_->get_Settings(&settings);
  if (settings) {
    settings->put_AreDefaultContextMenusEnabled(FALSE);
    settings->put_AreDevToolsEnabled(FALSE);
    settings->put_IsStatusBarEnabled(FALSE);
    settings->put_IsZoomControlEnabled(FALSE);
    ComPtr<ICoreWebView2Settings3> settings3;
    if (SUCCEEDED(settings.As(&settings3))) settings3->put_AreBrowserAcceleratorKeysEnabled(FALSE);
  }
  ApplyStationheadResourceBlocking(environment_.Get(), webview_.Get(), config_, resourceBlockingArmed_, resourceRequestedToken_);
  webview_->add_NavigationCompleted(
      Callback<ICoreWebView2NavigationCompletedEventHandler>(
          [this](ICoreWebView2*, ICoreWebView2NavigationCompletedEventArgs* args) -> HRESULT {
            BOOL success = FALSE;
            COREWEBVIEW2_WEB_ERROR_STATUS webError{};
            if (args) {
              args->get_IsSuccess(&success);
              args->get_WebErrorStatus(&webError);
            }
            if (spotifyAuthorization_) {
              std::lock_guard lock(mutex_);
              status_.navigating = false;
              status_.detail = success ? L"Spotify login ready" : L"Spotify authentication navigation failed";
              PostChange();
              return S_OK;
            }
            {
              std::lock_guard lock(mutex_);
              status_.navigating = false;
              status_.detail = success ? L"navigation completed" : L"navigation failed";
            }
            if (success) {
              lastReloadAt_ = UnixMillis();
              lastScanAt_ = 0;
              EvaluateStartupState();
            } else {
              ScheduleRecreate(L"navigation failed " + std::to_wstring(static_cast<int>(webError)));
            }
            PostChange();
            return S_OK;
          }).Get(), &navigationToken_);
  webview_->add_NewWindowRequested(
      Callback<ICoreWebView2NewWindowRequestedEventHandler>(
          [this](ICoreWebView2*, ICoreWebView2NewWindowRequestedEventArgs* args) -> HRESULT {
            if (!args || !environment_ || !EnsureAuthHostWindow()) return S_OK;
            LPWSTR uriRaw = nullptr;
            args->get_Uri(&uriRaw);
            const std::wstring uri = uriRaw ? uriRaw : L"";
            if (uriRaw) CoTaskMemFree(uriRaw);
            ComPtr<ICoreWebView2Deferral> deferral;
            if (FAILED(args->GetDeferral(&deferral)) || !deferral) return S_OK;
            ComPtr<ICoreWebView2NewWindowRequestedEventArgs> popupArgs = args;
            CloseAuthWebView();
            spotifyAuthorization_ = true;
            selectedTab_ = StationheadTabKind::Auth;
            viewVisible_ = true;
            LayoutControllers();
            const HRESULT createResult = environment_->CreateCoreWebView2Controller(
                authHostWindow_, Callback<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler>(
                                     [this, popupArgs, deferral, uri](HRESULT result, ICoreWebView2Controller* controller) -> HRESULT {
                                       if (FAILED(result) || !controller || shuttingDown_) {
                                         if (controller) controller->Close();
                                         spotifyAuthorization_ = false;
                                         deferral->Complete();
                                         PostChange();
                                         return S_OK;
                                       }
                                       authController_ = controller;
                                       authController_->put_IsVisible(FALSE);
                                       authController_->get_CoreWebView2(&authWebview_);
                                       ConfigureAuthWebView();
                                       if (SUCCEEDED(popupArgs->put_NewWindow(authWebview_.Get()))) {
                                         popupArgs->put_Handled(TRUE);
                                         SelectTab(StationheadTabKind::Auth);
                                         log_.Info(L"Stationhead popup attached to auth tab: " + uri);
                                       }
                                       deferral->Complete();
                                       PostChange();
                                       return S_OK;
                                     }).Get());
            if (FAILED(createResult)) {
              spotifyAuthorization_ = false;
              deferral->Complete();
              PostChange();
            }
            return S_OK;
          }).Get(), &newWindowToken_);
  webview_->add_WebMessageReceived(
      Callback<ICoreWebView2WebMessageReceivedEventHandler>(
          [this](ICoreWebView2*, ICoreWebView2WebMessageReceivedEventArgs* args) -> HRESULT {
            LPWSTR messageRaw = nullptr;
            if (FAILED(args->get_WebMessageAsJson(&messageRaw)) || !messageRaw) return S_OK;
            const std::wstring messageJson = messageRaw;
            CoTaskMemFree(messageRaw);
            try {
              const auto message = winrt::Windows::Data::Json::JsonObject::Parse(messageJson);
              const std::wstring type = message.GetNamedString(L"type", L"").c_str();
              if (type == L"stationhead-audio-state") {
                const bool playing = message.GetNamedBoolean(L"playing", false);
                const bool stopped = message.GetNamedBoolean(L"stopped", false);
                const int64_t now = UnixMillis();
                audioStateKnown_ = true;
                audioPlaying_ = playing;
                if (playing) lastAudioAtMs_ = now;
                const std::wstring title = message.GetNamedString(L"title", L"").c_str();
                const std::wstring artist = message.GetNamedString(L"artist", L"").c_str();
                const std::wstring artwork = message.GetNamedString(L"artwork", L"").c_str();
                bool revealPlayer = false;
                {
                  std::lock_guard lock(mutex_);
                  status_.audioPlaying = playing;
                  status_.audioSilent = false;
                  if (!title.empty()) status_.trackTitle = title;
                  if (!artist.empty()) status_.trackArtist = artist;
                  if (!artwork.empty()) status_.artworkUrl = artwork;
                  revealPlayer = stopped && !playing;
                }
                nextTickAt_ = 0;
                PostChange(revealPlayer ? StationheadChangeShowPlayer : StationheadChangeNone);
                return S_OK;
              }
              if (!spotifyAuthorization_ || (type != L"spotify-connected" && type != L"spotify-error")) return S_OK;
              spotifyAuthorization_ = false;
              showAfterNavigation_ = false;
              {
                std::lock_guard lock(mutex_);
                status_.navigating = false;
                status_.spotifyConfigured = type == L"spotify-connected";
                status_.detail = type == L"spotify-connected" ? L"Spotify authentication completed" : L"Spotify authentication failed or cancelled";
              }
              SetVisible(false);
              PostChange(StationheadChangeReturnMain | StationheadChangeReleaseAuth);
            } catch (...) {
            }
            return S_OK;
          }).Get(), &webMessageToken_);
  webview_->add_ProcessFailed(
      Callback<ICoreWebView2ProcessFailedEventHandler>(
          [this](ICoreWebView2*, ICoreWebView2ProcessFailedEventArgs* args) -> HRESULT {
            COREWEBVIEW2_PROCESS_FAILED_KIND kind{};
            if (args) args->get_ProcessFailedKind(&kind);
            {
              std::lock_guard lock(mutex_);
              status_.processFailed = true;
              status_.detail = L"ProcessFailed " + std::to_wstring(kind);
            }
            ScheduleRecreate(L"ProcessFailed");
            return S_OK;
          }).Get(), &processFailedToken_);
  ComPtr<ICoreWebView2_19> v19;
  if (config_.lowMemoryMode && SUCCEEDED(webview_.As(&v19))) {
    // Was set to NORMAL (the default) instead of LOW, silently making this a
    // no-op whenever low-memory mode was actually requested.
    v19->put_MemoryUsageTargetLevel(COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW);
  }
  {
    std::lock_guard lock(mutex_);
    const bool playing = status_.playing;
    const bool spotifyConfigured = status_.spotifyConfigured;
    const int64_t lastConfirmed = status_.lastPlaybackConfirmedAt;
    status_ = {};
    status_.created = true;
    status_.navigating = true;
    status_.url = config_.url;
    status_.detail = L"起動中";
    status_.playing = playing;
    status_.spotifyConfigured = spotifyConfigured;
    status_.lastPlaybackConfirmedAt = lastConfirmed;
  }
  createdAt_ = lastReloadAt_ = UnixMillis();
  startupScanUntil_ = createdAt_ + 120'000;
  waitingForStartTransition_ = false;
  lastAudioAtMs_ = 0;
  lastScanAt_ = 0;
  targetSignature_.clear();
  stableTargetCount_ = 0;
  audioPlaying_ = false;
  audioStateKnown_ = false;
  nextTickAt_ = 0;
  auto startStationheadNavigation = [this]() {
    if (!pendingAuthorizationUrl_.empty()) {
      const std::wstring authorizationUrl = pendingAuthorizationUrl_;
      pendingAuthorizationUrl_.clear();
      OpenSpotifyAuthorization(authorizationUrl);
      return;
    }
    NavigatePrimaryUrl(UnixMillis(), L"startup");
  };
  const HRESULT patchRegistration = webview_->AddScriptToExecuteOnDocumentCreated(
      kStationheadAppPatch,
      Callback<ICoreWebView2AddScriptToExecuteOnDocumentCreatedCompletedHandler>(
          [this, startStationheadNavigation](HRESULT result, LPCWSTR) -> HRESULT {
            if (FAILED(result)) log_.Warn(L"Stationhead audio observer registration failed " + HResultHex(result));
            startStationheadNavigation();
            return S_OK;
          }).Get());
  if (FAILED(patchRegistration)) startStationheadNavigation();
}

void StationheadPlayer::CloseWebView() {
  controllerLayoutValid_ = false;
  if (webview_) {
    if (navigationToken_.value) webview_->remove_NavigationCompleted(navigationToken_);
    if (newWindowToken_.value) webview_->remove_NewWindowRequested(newWindowToken_);
    if (webMessageToken_.value) webview_->remove_WebMessageReceived(webMessageToken_);
    if (processFailedToken_.value) webview_->remove_ProcessFailed(processFailedToken_);
    if (resourceRequestedToken_.value) webview_->remove_WebResourceRequested(resourceRequestedToken_);
  }
  navigationToken_ = {};
  newWindowToken_ = {};
  webMessageToken_ = {};
  processFailedToken_ = {};
  resourceRequestedToken_ = {};
  resourceBlockingArmed_ = false;
  if (controller_) controller_->Close();
  webview_.Reset();
  controller_.Reset();
  environment_.Reset();
  if (hostWindow_ && IsWindow(hostWindow_)) ShowWindow(hostWindow_, SW_HIDE);
  scanPending_ = false;
  spotifyAuthorization_ = false;
  loginSessionActive_ = false;
  showAfterNavigation_ = false;
  std::lock_guard lock(mutex_);
  status_.created = false;
  status_.lightweight = false;
}

void StationheadPlayer::ConfigureAuthWebView() {
  if (!authController_ || !authWebview_) return;
  ComPtr<ICoreWebView2Controller2> controller2;
  if (SUCCEEDED(authController_.As(&controller2))) {
    COREWEBVIEW2_COLOR background{255, 7, 17, 28};
    controller2->put_DefaultBackgroundColor(background);
  }
  ComPtr<ICoreWebView2Settings> settings;
  authWebview_->get_Settings(&settings);
  if (settings) {
    settings->put_AreDefaultContextMenusEnabled(FALSE);
    settings->put_AreDevToolsEnabled(FALSE);
    settings->put_IsStatusBarEnabled(FALSE);
    settings->put_IsZoomControlEnabled(FALSE);
  }
  authWebview_->add_NavigationCompleted(
      Callback<ICoreWebView2NavigationCompletedEventHandler>(
          [this](ICoreWebView2*, ICoreWebView2NavigationCompletedEventArgs* args) -> HRESULT {
            BOOL success = FALSE;
            if (args) args->get_IsSuccess(&success);
            if (success) {
              SelectTab(StationheadTabKind::Auth);
              authWebview_->PostWebMessageAsJson(L"{\"type\":\"auth-tab-ready\"}");
            }
            return S_OK;
          }).Get(), &authNavigationToken_);
  authWebview_->add_WindowCloseRequested(
      Callback<ICoreWebView2WindowCloseRequestedEventHandler>(
          [this](ICoreWebView2*, IUnknown*) -> HRESULT {
            spotifyAuthorization_ = false;
            showAfterNavigation_ = false;
            authPendingUrl_.clear();
            SelectTab(StationheadTabKind::None);
            PostChange(StationheadChangeReturnMain | StationheadChangeReleaseAuth);
            return S_OK;
          }).Get(), &authCloseToken_);
  authWebview_->add_WebMessageReceived(
      Callback<ICoreWebView2WebMessageReceivedEventHandler>(
          [this](ICoreWebView2*, ICoreWebView2WebMessageReceivedEventArgs* args) -> HRESULT {
            LPWSTR messageRaw = nullptr;
            if (FAILED(args->get_WebMessageAsJson(&messageRaw)) || !messageRaw) return S_OK;
            const std::wstring messageJson = messageRaw;
            CoTaskMemFree(messageRaw);
            try {
              const auto message = winrt::Windows::Data::Json::JsonObject::Parse(messageJson);
              const std::wstring type = message.GetNamedString(L"type", L"").c_str();
              if (type != L"spotify-connected" && type != L"spotify-error") return S_OK;
              spotifyAuthorization_ = false;
              showAfterNavigation_ = false;
              authPendingUrl_.clear();
              {
                std::lock_guard lock(mutex_);
                status_.navigating = false;
                status_.spotifyConfigured = type == L"spotify-connected";
                status_.detail = type == L"spotify-connected" ? L"Spotify authentication completed" : L"Spotify authentication failed or cancelled";
              }
              SelectTab(StationheadTabKind::None);
              PostChange(StationheadChangeReturnMain | StationheadChangeReleaseAuth);
            } catch (...) {
            }
            return S_OK;
          }).Get(), &authMessageToken_);
  authWebview_->add_ProcessFailed(
      Callback<ICoreWebView2ProcessFailedEventHandler>(
          [this](ICoreWebView2*, ICoreWebView2ProcessFailedEventArgs*) -> HRESULT {
            SelectTab(StationheadTabKind::None);
            PostChange(StationheadChangeReturnMain);
            return S_OK;
          }).Get(), &authProcessFailedToken_);
  if (!authPendingUrl_.empty()) authWebview_->Navigate(authPendingUrl_.c_str());
}

void StationheadPlayer::CloseAuthWebView() {
  controllerLayoutValid_ = false;
  if (authWebview_) {
    if (authNavigationToken_.value) authWebview_->remove_NavigationCompleted(authNavigationToken_);
    if (authMessageToken_.value) authWebview_->remove_WebMessageReceived(authMessageToken_);
    if (authProcessFailedToken_.value) authWebview_->remove_ProcessFailed(authProcessFailedToken_);
    if (authCloseToken_.value) authWebview_->remove_WindowCloseRequested(authCloseToken_);
  }
  authNavigationToken_ = {};
  authMessageToken_ = {};
  authProcessFailedToken_ = {};
  authCloseToken_ = {};
  if (authController_) authController_->Close();
  authWebview_.Reset();
  authController_.Reset();
  authPendingUrl_.clear();
}

}  // namespace hp
