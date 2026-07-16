from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    print(f"{label}: {count} match(es)")
    if count != 1:
        raise SystemExit(f"{label}: expected one match, found {count}")
    return text.replace(old, new, 1)


app_path = Path("native/src/app.cpp")
app = app_path.read_text(encoding="utf-8")
app = replace_once(
    app,
    "constexpr int64_t kDashboardStartupFallbackMs = 30'000;\n",
    "constexpr int64_t kDashboardStartupFallbackMs = 30'000;\n"
    "constexpr int64_t kDashboardAudioStabilityMs = 1'500;\n",
    "add dashboard audio stability policy",
)
app = replace_once(
    app,
    "static_assert(kDashboardStartupFallbackMs == 30'000);\n",
    "static_assert(kDashboardStartupFallbackMs == 30'000);\n"
    "static_assert(kDashboardAudioStabilityMs >= 1'000);\n",
    "assert dashboard stability policy",
)
app = replace_once(
    app,
    "  const bool dashboardAudioReady =\n"
    "      DashboardAudioReady(primaryAudioReady, secondaryEnabled, secondaryAudioReady);\n"
    "  const bool startupDeadlineReached = now - startupAt_ >= kDashboardStartupFallbackMs;\n"
    "  if (dashboardAudioReady && playbackReadyAt_ == 0) playbackReadyAt_ = now;\n"
    "\n"
    "  if (!rendererStarted_ && (dashboardAudioReady || startupDeadlineReached)) {\n",
    "  const bool dashboardAudioReady =\n"
    "      DashboardAudioReady(primaryAudioReady, secondaryEnabled, secondaryAudioReady);\n"
    "  if (dashboardAudioReady) {\n"
    "    if (dashboardAudioReadySince_ == 0) dashboardAudioReadySince_ = now;\n"
    "  } else {\n"
    "    dashboardAudioReadySince_ = 0;\n"
    "  }\n"
    "  const bool stableDashboardAudio = dashboardAudioReady &&\n"
    "      dashboardAudioReadySince_ > 0 &&\n"
    "      now - dashboardAudioReadySince_ >= kDashboardAudioStabilityMs;\n"
    "  const bool startupDeadlineReached = now - startupAt_ >= kDashboardStartupFallbackMs;\n"
    "  if (stableDashboardAudio && playbackReadyAt_ == 0) playbackReadyAt_ = now;\n"
    "\n"
    "  if (!rendererStarted_ && (stableDashboardAudio || startupDeadlineReached)) {\n",
    "require sustained audio before dashboard startup",
)
app = replace_once(
    app,
    "    if (dashboardAudioReady) {\n"
    "      logger_->Info(secondaryEnabled\n",
    "    if (stableDashboardAudio) {\n"
    "      logger_->Info(secondaryEnabled\n",
    "log stable dashboard confirmation",
)
app = replace_once(
    app,
    "  if (!cloudStarted_ && (dashboardAudioReady || startupDeadlineReached)) {\n",
    "  if (!cloudStarted_ && (stableDashboardAudio || startupDeadlineReached)) {\n",
    "gate cloud on stable audio",
)
app = replace_once(
    app,
    "    logger_->Info(dashboardAudioReady\n"
    "        ? L\"Cloud synchronization started after Stationhead startup confirmation\"\n",
    "    logger_->Info(stableDashboardAudio\n"
    "        ? L\"Cloud synchronization started after stable Stationhead startup confirmation\"\n",
    "log stable cloud confirmation",
)
app_path.write_text(app, encoding="utf-8")

app_header_path = Path("native/src/app.h")
app_header = app_header_path.read_text(encoding="utf-8")
app_header = replace_once(
    app_header,
    "  int64_t startupAt_ = 0;\n"
    "  int64_t playbackReadyAt_ = 0;\n",
    "  int64_t startupAt_ = 0;\n"
    "  int64_t dashboardAudioReadySince_ = 0;\n"
    "  int64_t playbackReadyAt_ = 0;\n",
    "track sustained dashboard audio",
)
app_header_path.write_text(app_header, encoding="utf-8")

shared_path = Path("native/src/sh_shared.h")
shared = shared_path.read_text(encoding="utf-8")
shared = replace_once(
    shared,
    "inline constexpr int64_t kStationheadPostPlaybackStopClickDelayMs = 5'000;\n",
    "inline constexpr int64_t kStationheadPostPlaybackStopClickDelayMs = 12'000;\n",
    "align post-stop click delay with transition grace",
)
shared_path.write_text(shared, encoding="utf-8")

header_path = Path("native/src/sh.h")
header = header_path.read_text(encoding="utf-8")
header = replace_once(
    header,
    "  void TryStartInitialNavigation();\n"
    "  void EnsureDistinctBrowserIdentity() noexcept;\n",
    "  void TryStartInitialNavigation();\n"
    "  void CompletePendingAuthPopupDeferral() noexcept;\n"
    "  void EnsureDistinctBrowserIdentity() noexcept;\n",
    "declare popup deferral completion",
)
header = replace_once(
    header,
    "  ComPtr<ICoreWebView2Controller> authController_;\n"
    "  ComPtr<ICoreWebView2> authWebview_;\n",
    "  ComPtr<ICoreWebView2Controller> authController_;\n"
    "  ComPtr<ICoreWebView2> authWebview_;\n"
    "  ComPtr<ICoreWebView2Deferral> authPopupDeferral_;\n"
    "  std::shared_ptr<std::atomic<bool>> authPopupDeferralCompleted_;\n",
    "store pending popup deferral",
)
header = replace_once(
    header,
    "  bool startupNavigationStarted_ = false;\n"
    "  int64_t nextTickAt_ = 0;\n",
    "  bool startupNavigationStarted_ = false;\n"
    "  bool stationNavigationStarted_ = false;\n"
    "  int64_t nextTickAt_ = 0;\n",
    "track actual Stationhead navigation",
)
header_path.write_text(header, encoding="utf-8")

sh_path = Path("native/src/sh.cpp")
sh = sh_path.read_text(encoding="utf-8")
sh = replace_once(
    sh,
    "  if (!webview_ || url.empty()) return;\n"
    "  SetStartupBounds();\n",
    "  if (!webview_ || url.empty()) return;\n"
    "  stationNavigationStarted_ = true;\n"
    "  SetStartupBounds();\n",
    "record actual Stationhead navigation",
)
sh = replace_once(
    sh,
    "void StationheadPlayer::EnsureAuthController(const std::wstring& url) {\n",
    "void StationheadPlayer::CompletePendingAuthPopupDeferral() noexcept {\n"
    "  ComPtr<ICoreWebView2Deferral> deferral = authPopupDeferral_;\n"
    "  const auto completed = authPopupDeferralCompleted_;\n"
    "  authPopupDeferral_.Reset();\n"
    "  authPopupDeferralCompleted_.reset();\n"
    "  if (deferral && completed &&\n"
    "      !completed->exchange(true, std::memory_order_acq_rel)) {\n"
    "    deferral->Complete();\n"
    "  }\n"
    "}\n"
    "\n"
    "void StationheadPlayer::EnsureAuthController(const std::wstring& url) {\n",
    "implement one-shot popup deferral completion",
)
sh = replace_once(
    sh,
    "    authCallbackAlive_->store(false, std::memory_order_release);\n"
    "    authControllerStartedAt_ = 0;\n"
    "    FinishSpotifyAuthorization(L\"Spotify auth controller creation timed out\");\n",
    "    authCallbackAlive_->store(false, std::memory_order_release);\n"
    "    authControllerStartedAt_ = 0;\n"
    "    CompletePendingAuthPopupDeferral();\n"
    "    FinishSpotifyAuthorization(L\"Spotify auth controller creation timed out\");\n",
    "complete popup deferral on auth timeout",
)
old_finish = (
    "void StationheadPlayer::FinishSpotifyAuthorization(const std::wstring& detail) {\n"
    "  spotifyAuthorization_ = false;\n"
    "  {\n"
    "    std::lock_guard lock(mutex_);\n"
    "    status_.detail = detail;\n"
    "  }\n"
    "  SelectTab(StationheadTabKind::None);\n"
    "  PostChange(StationheadChangeReturnMain | StationheadChangeReleaseAuth);\n"
    "}\n"
)
new_finish = (
    "void StationheadPlayer::FinishSpotifyAuthorization(const std::wstring& detail) {\n"
    "  spotifyAuthorization_ = false;\n"
    "  {\n"
    "    std::lock_guard lock(mutex_);\n"
    "    status_.detail = detail;\n"
    "  }\n"
    "  if (webview_ && !stationNavigationStarted_) {\n"
    "    NavigateCurrentUrl(UnixMillis(), L\"post-auth startup\");\n"
    "  }\n"
    "  SelectTab(StationheadTabKind::None);\n"
    "  PostChange(StationheadChangeReturnMain | StationheadChangeReleaseAuth);\n"
    "}\n"
)
sh = replace_once(sh, old_finish, new_finish, "resume Stationhead navigation after pre-start auth")
sh_path.write_text(sh, encoding="utf-8")

webview_path = Path("native/src/sh_webview.cpp")
webview = webview_path.read_text(encoding="utf-8")
start = webview.index("  webview_->add_NewWindowRequested(")
end_marker = "          }).Get(), &newWindowToken_);\n"
end = webview.index(end_marker, start) + len(end_marker)
old_popup = webview[start:end]
new_popup = '''  webview_->add_NewWindowRequested(
      Callback<ICoreWebView2NewWindowRequestedEventHandler>(
          [this, alive](ICoreWebView2*, ICoreWebView2NewWindowRequestedEventArgs* args) -> HRESULT {
            if (!CallbackAlive(alive) || !args) return S_OK;

            if (!environment_ || !EnsureAuthHostWindow()) {
              args->put_Handled(FALSE);
              log_.Warn(L"Stationhead " + std::wstring(RoleTag()) +
                        L" could not prepare the Spotify popup host");
              return S_OK;
            }
            LPWSTR uriRaw = nullptr;
            args->get_Uri(&uriRaw);
            const std::wstring uri = uriRaw ? uriRaw : L"";
            if (uriRaw) CoTaskMemFree(uriRaw);
            ComPtr<ICoreWebView2Deferral> deferral;
            if (FAILED(args->GetDeferral(&deferral)) || !deferral) {
              args->put_Handled(FALSE);
              return S_OK;
            }
            args->put_Handled(TRUE);
            const auto deferralCompleted =
                std::make_shared<std::atomic<bool>>(false);
            const auto completeDeferral = [deferral, deferralCompleted]() noexcept {
              if (!deferralCompleted->exchange(true, std::memory_order_acq_rel)) {
                deferral->Complete();
              }
            };
            ComPtr<ICoreWebView2NewWindowRequestedEventArgs> popupArgs = args;
            CloseAuthWebView();
            authPopupDeferral_ = deferral;
            authPopupDeferralCompleted_ = deferralCompleted;
            authCallbackAlive_ = std::make_shared<std::atomic<bool>>(true);
            const auto authAlive = authCallbackAlive_;
            authControllerStartedAt_ = UnixMillis();
            spotifyAuthorization_ = true;
            SelectTab(StationheadTabKind::Auth);

            const auto onController = Callback<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler>(
                [this, popupArgs, completeDeferral, uri, authAlive](HRESULT result,
                    ICoreWebView2Controller* controller) -> HRESULT {
                  if (!CallbackAlive(authAlive)) {
                    if (controller) controller->Close();
                    completeDeferral();
                    return S_OK;
                  }
                  authControllerStartedAt_ = 0;
                  if (FAILED(result) || !controller || shuttingDown_) {
                    if (controller) controller->Close();
                    FinishSpotifyAuthorization(L"Spotify popup creation failed " + HResultHex(result));
                    CompletePendingAuthPopupDeferral();
                    return S_OK;
                  }
                  authController_ = controller;
                  authController_->put_IsVisible(FALSE);
                  authController_->get_CoreWebView2(&authWebview_);
                  if (!authWebview_) {
                    FinishSpotifyAuthorization(L"Spotify popup WebView unavailable");
                    CompletePendingAuthPopupDeferral();
                    return S_OK;
                  }
                  ConfigureAuthWebView();
                  if (SUCCEEDED(popupArgs->put_NewWindow(authWebview_.Get()))) {
                    popupArgs->put_Handled(TRUE);
                    SelectTab(StationheadTabKind::Auth);
                    log_.Info(L"Stationhead " + std::wstring(RoleTag()) +
                              L" popup attached to auth tab: " + uri);
                  } else {
                    FinishSpotifyAuthorization(L"Spotify popup attachment failed");
                  }
                  CompletePendingAuthPopupDeferral();
                  return S_OK;
                });

            const HRESULT createResult =
                environment_->CreateCoreWebView2Controller(authHostWindow_, onController.Get());
            if (FAILED(createResult)) {
              authControllerStartedAt_ = 0;
              authCallbackAlive_->store(false, std::memory_order_release);
              FinishSpotifyAuthorization(
                  L"Spotify popup creation could not start " + HResultHex(createResult));
              CompletePendingAuthPopupDeferral();
            }
            return S_OK;
          }).Get(), &newWindowToken_);
'''
webview = webview[:start] + new_popup + webview[end:]
webview = replace_once(
    webview,
    "  startupNavigationStarted_ = false;\n"
    "  startupScriptDeadline_ = 0;\n"
    "  ResetNavigationRouteState();\n",
    "  startupNavigationStarted_ = false;\n"
    "  stationNavigationStarted_ = false;\n"
    "  startupScriptDeadline_ = 0;\n"
    "  ResetNavigationRouteState();\n",
    "reset actual navigation state on recreation",
)
webview = replace_once(
    webview,
    "void StationheadPlayer::CloseAuthWebView() {\n"
    "  authCallbackAlive_->store(false, std::memory_order_release);\n"
    "  authControllerStartedAt_ = 0;\n",
    "void StationheadPlayer::CloseAuthWebView() {\n"
    "  authCallbackAlive_->store(false, std::memory_order_release);\n"
    "  authControllerStartedAt_ = 0;\n"
    "  CompletePendingAuthPopupDeferral();\n",
    "complete pending popup deferral on close",
)
webview_path.write_text(webview, encoding="utf-8")

combined = "\n".join(
    path.read_text(encoding="utf-8")
    for path in [app_path, app_header_path, shared_path, header_path, sh_path, webview_path]
)
for marker in [
    "kDashboardAudioStabilityMs",
    "dashboardAudioReadySince_",
    "stationNavigationStarted_",
    "post-auth startup",
    "authPopupDeferralCompleted_",
    "CompletePendingAuthPopupDeferral()",
    "kStationheadPostPlaybackStopClickDelayMs = 12'000",
]:
    if marker not in combined:
        raise SystemExit(f"missing transition-completion marker: {marker}")
