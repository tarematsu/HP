namespace hp {

void SpotifyWebViews::RebuildPlaybackSurface(Slot& slot) noexcept {
  UnsubscribeMediaPipelineErrors(slot.mediaErrorReceiver, slot.mediaErrorToken);
  if (slot.webview) {
    if (slot.navigationStartingToken.value != 0) {
      slot.webview->remove_NavigationStarting(slot.navigationStartingToken);
    }
    if (slot.navigationCompletedToken.value != 0) {
      slot.webview->remove_NavigationCompleted(slot.navigationCompletedToken);
    }
    if (slot.timedEndMessageReceivedToken.value != 0) {
      slot.webview->remove_WebMessageReceived(slot.timedEndMessageReceivedToken);
    }
  }
  slot.navigationStartingToken = {};
  slot.navigationCompletedToken = {};
  slot.timedEndMessageReceivedToken = {};
  slot.timedEndHandlerWebview = nullptr;
  slot.webview.Reset();
  if (slot.controller) slot.controller->Close();
  slot.controller.Reset();
  slot.environment.Reset();
  slot.hostLayoutController = nullptr;
  slot.hostLayoutRect = {};
  slot.hostLayoutInsertAfter = nullptr;
  slot.hostLayoutApplied = false;
  slot.controllerCreating = false;
  slot.controllerCreateTick = 0;
  ++slot.asyncEpoch;
  if (slot.asyncEpoch == 0) ++slot.asyncEpoch;
  ++slot.pageEpoch;
  if (slot.pageEpoch == 0) ++slot.pageEpoch;
  slot.asyncWork = AsyncWork::None;
  slot.asyncStartedTick = 0;
  slot.nextProcessTitlePollTick = 0;
  slot.trustedClickBlockedUntilTick = 0;
  slot.memoryUsageTargetLevel = -1;
  slot.timedCompletionDeadlineTick = 0;
  slot.timedCompletionDeadlineGeneration = 0;
  slot.loginPage = false;
  slot.playbackConfirmed = false;
  slot.processTitleObserved = false;
  slot.observedTrackTitle.clear();
  slot.processTrackDisplay.clear();
  slot.processTitleObservedAt = {};
  slot.playbackConfirmedAt = {};
  slot.mediaPipelineRecoveryPending = false;
  SetSlotState(slot, SlotState::NotCreated);
  slot.nextRecoveryTick = GetTickCount64();
  RecomputeForeground();
  ArmRobustScheduler();
}

void SpotifyWebViews::CreateController(Slot& slot) noexcept {
  if (!slot.hostWindow || !IsWindow(slot.hostWindow) || slot.controller || slot.webview) return;
  SetSlotState(slot, SlotState::NotCreated);
  slot.controllerCreating = true;
  slot.controllerCreateTick = GetTickCount64();
  const auto alive = alive_;
  Slot* const target = &slot;
  try {
    SharedWebViewEnvironment::Instance().Acquire(
        userDataFolder_, false, false,
        [this, alive, target](HRESULT result, ICoreWebView2Environment* environment) {
          if (!alive->load(std::memory_order_acquire)) return;
          if (FAILED(result) || !environment || !target->hostWindow || !IsWindow(target->hostWindow)) {
            target->controllerCreating = false;
            MarkSlotRecovering(*target, GetTickCount64());
            ArmRobustScheduler();
            return;
          }
          target->environment = environment;

          ComPtr<ICoreWebView2Environment10> environment10;
          ComPtr<ICoreWebView2ControllerOptions> options;
          const std::wstring profileName = std::wstring(kSpotifyProfilePrefix) +
              std::to_wstring(target->index + kSpotifyProfileFirstAccountNumber);
          if (FAILED(environment->QueryInterface(IID_PPV_ARGS(&environment10))) ||
              !environment10 ||
              FAILED(environment10->CreateCoreWebView2ControllerOptions(&options)) ||
              !options || FAILED(options->put_ProfileName(profileName.c_str())) ||
              FAILED(options->put_IsInPrivateModeEnabled(FALSE))) {
            target->controllerCreating = false;
            MarkSlotRecovering(*target, GetTickCount64());
            ArmRobustScheduler();
            return;
          }

          const auto ready = Callback<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler>(
              [this, alive, target](HRESULT controllerResult, ICoreWebView2Controller* controller) -> HRESULT {
                if (!alive->load(std::memory_order_acquire)) {
                  if (controller) controller->Close();
                  return S_OK;
                }
                target->controllerCreating = false;
                if (FAILED(controllerResult) || !controller || !target->hostWindow || !IsWindow(target->hostWindow)) {
                  if (controller) controller->Close();
                  MarkSlotRecovering(*target, GetTickCount64());
                  ArmRobustScheduler();
                  return S_OK;
                }
                target->controller = controller;
                target->controller->get_CoreWebView2(&target->webview);
                if (!target->webview) {
                  target->controller->Close();
                  target->controller.Reset();
                  MarkSlotRecovering(*target, GetTickCount64());
                  ArmRobustScheduler();
                  return S_OK;
                }
                target->controllerCreateTick = 0;
                Configure(*target);
                ArmRobustScheduler();
                return S_OK;
              });

          const HRESULT createResult = environment10->CreateCoreWebView2ControllerWithOptions(
              target->hostWindow, options.Get(), ready.Get());
          if (FAILED(createResult)) {
            target->controllerCreating = false;
            MarkSlotRecovering(*target, GetTickCount64());
            ArmRobustScheduler();
          }
        });
  } catch (...) {
    slot.controllerCreating = false;
    MarkSlotRecovering(slot, GetTickCount64());
    ArmRobustScheduler();
  }
}

void SpotifyWebViews::Configure(Slot& slot) noexcept {
  if (!slot.controller || !slot.webview) return;
  try {
    SetSpotifyOutputMuted(slot.webview);
    Slot* const target = &slot;
    const auto alive = alive_;
    const HRESULT mediaErrorResult = SubscribeMediaPipelineErrors(
        slot.webview.Get(),
        Callback<ICoreWebView2DevToolsProtocolEventReceivedEventHandler>(
            [this, alive, target](
                ICoreWebView2*,
                ICoreWebView2DevToolsProtocolEventReceivedEventArgs*)
                -> HRESULT {
              if (!alive->load(std::memory_order_acquire) ||
                  !started_ || !target->webview || target->loginPage ||
                  !CurrentMusicTrack(*target) ||
                  target->targetGeneration == 0) {
                return S_OK;
              }
              try {
                if (target->mediaPipelineRecoveryGeneration ==
                    target->targetGeneration) {
                  return S_OK;
                }
                target->mediaPipelineRecoveryGeneration =
                    target->targetGeneration;
                target->mediaPipelineRecoveryPending = true;
                SetSlotState(*target, SlotState::Recovering);
                target->nextRecoveryTick = GetTickCount64();
                ArmRobustScheduler();
              } catch (...) {
                // Keep failures contained inside the WebView2 callback. The
                // periodic native-audio probe remains the fallback detector.
              }
              return S_OK;
            }).Get(),
        slot.mediaErrorReceiver, slot.mediaErrorToken);
    if (FAILED(mediaErrorResult)) {
      slot.mediaErrorReceiver.Reset();
      slot.mediaErrorToken = {};
    }
    // Keep the renderer active at all times. Background cost is controlled by
    // clipping the host to 1x1 while keeping a stable internal viewport.
    slot.controller->put_IsVisible(TRUE);

    ComPtr<ICoreWebView2Controller2> controller2;
    if (SUCCEEDED(slot.controller.As(&controller2)) && controller2) {
      COREWEBVIEW2_COLOR background{255, 0, 0, 0};
      controller2->put_DefaultBackgroundColor(background);
    }
    ApplyMediaWebViewFeaturePolicy(
        slot.controller.Get(), slot.webview.Get(), true);

    // Each account is sampled once per minute, with C/D/E phased 20 seconds
    // apart from the common schedule start so their DOM probes never bunch up.
    const ULONGLONG statusPhaseBase =
        scheduleStartTick_ != 0 ? scheduleStartTick_ : GetTickCount64();
    slot.nextProcessTitlePollTick =
        statusPhaseBase +
        static_cast<ULONGLONG>(slot.index) * kSpotifyProcessTitlePollPhaseMs;

    slot.webview->add_NavigationStarting(
        Callback<ICoreWebView2NavigationStartingEventHandler>(
            [this, alive, target](ICoreWebView2* sender, ICoreWebView2NavigationStartingEventArgs* args) -> HRESULT {
              if (!alive->load(std::memory_order_acquire) || !sender || !args) return S_OK;
              ++target->pageEpoch; if (target->pageEpoch == 0) ++target->pageEpoch;
              ++target->asyncEpoch; if (target->asyncEpoch == 0) ++target->asyncEpoch;
              target->asyncWork = AsyncWork::None;
              target->asyncStartedTick = 0;
              target->trustedClickBlockedUntilTick = 0;
              target->loginPage = false;
              target->timedObserverReady = false;
              LPWSTR rawUri = nullptr;
              if (SUCCEEDED(args->get_Uri(&rawUri)) && rawUri) {
                target->loginPage = IsSpotifyLoginUri(rawUri);
                CoTaskMemFree(rawUri);
              }
              const ULONGLONG now = GetTickCount64();
              SetSlotState(*target, target->loginPage ? SlotState::Authenticating : SlotState::Navigating);
              if (target->controller) {
                target->controller->put_Bounds(
                    SpotifyControllerBounds(target->hostWindow, target->loginPage));
              }
              if (!target->loginPage) target->nextRecoveryTick = now + kSpotifyRecoveryRetryMs;
              RecomputeForeground();
              ArmRobustScheduler();
              return S_OK;
            }).Get(), &slot.navigationStartingToken);

    slot.webview->add_NavigationCompleted(
        Callback<ICoreWebView2NavigationCompletedEventHandler>(
            [this, alive, target](ICoreWebView2* sender, ICoreWebView2NavigationCompletedEventArgs* args) -> HRESULT {
              if (!alive->load(std::memory_order_acquire) || !sender || !args) return S_OK;
              SetSpotifyOutputMuted(target->webview);
              if (target->controller) target->controller->put_IsVisible(TRUE);
              BOOL success = FALSE;
              if (FAILED(args->get_IsSuccess(&success)) || !success) {
                MarkSlotRecovering(*target, GetTickCount64());
                RecomputeForeground();
                ArmRobustScheduler();
                return S_OK;
              }
              LPWSTR rawUri = nullptr;
              bool playerPage = false;
              bool loginPage = false;
              if (SUCCEEDED(sender->get_Source(&rawUri)) && rawUri) {
                playerPage = IsSpotifyPlayerUri(rawUri);
                loginPage = IsSpotifyLoginUri(rawUri);
                CoTaskMemFree(rawUri);
              }
              target->loginPage = loginPage;
              const ULONGLONG now = GetTickCount64();
              SetSlotState(*target, loginPage ? SlotState::Authenticating : (playerPage ? SlotState::WaitingTarget : SlotState::Navigating));
              if (target->controller) {
                target->controller->put_Bounds(
                    SpotifyControllerBounds(target->hostWindow, loginPage));
              }
              target->nextRecoveryTick = playerPage || loginPage ? 0 : now + kSpotifyRecoveryRetryMs;
              RecomputeForeground();
              if (!playerPage) { ArmRobustScheduler(); return S_OK; }

              ApplySpotifyLightweightCss(sender);
              const ULONGLONG pageEpoch = target->pageEpoch;
              const HRESULT bootstrap = sender->ExecuteScript(
                  kSpotifyStaticPageBootstrapScript,
                  Callback<ICoreWebView2ExecuteScriptCompletedHandler>(
                      [this, alive, target, pageEpoch](HRESULT result, LPCWSTR) -> HRESULT {
                        if (!alive->load(std::memory_order_acquire) || target->pageEpoch != pageEpoch) return S_OK;
                        if (FAILED(result) || !started_ || !target->webview) {
                          if (started_ && target->webview) {
                            MarkSlotRecovering(*target, GetTickCount64());
                            ArmRobustScheduler();
                          }
                          return S_OK;
                        }
                        PostSpotifyTargetDescriptorForSlot(*target);
                        ArmRobustScheduler();
                        return S_OK;
                      }).Get());
              if (FAILED(bootstrap)) {
                MarkSlotRecovering(*target, GetTickCount64());
                ArmRobustScheduler();
              }
              return S_OK;
            }).Get(), &slot.navigationCompletedToken);

    slot.controller->put_Bounds(
        SpotifyControllerBounds(slot.hostWindow, slot.loginPage));
    slot.controller->put_IsVisible(TRUE);
    SetSlotState(slot, SlotState::Authenticating);
    if (FAILED(slot.webview->Navigate(kSpotifyLoginUrl))) {
      MarkSlotRecovering(slot, GetTickCount64());
    }
    ArmRobustScheduler();
  } catch (...) {
    MarkSlotRecovering(slot, GetTickCount64());
    ArmRobustScheduler();
  }
}

bool SpotifyWebViews::IsSpotifyPlayerUri(const wchar_t* uri) noexcept {
  if (!uri) return false;
  const std::wstring_view value(uri);
  return StartsWithInsensitive(value, L"https://open.spotify.com/") && !StartsWithInsensitive(value, L"https://open.spotify.com/login");
}

bool SpotifyWebViews::IsSpotifyLoginUri(const wchar_t* uri) noexcept {
  if (!uri) return false;
  const std::wstring_view value(uri);
  return StartsWithInsensitive(value, L"https://accounts.spotify.com/") || StartsWithInsensitive(value, L"https://open.spotify.com/login");
}

}  // namespace hp
