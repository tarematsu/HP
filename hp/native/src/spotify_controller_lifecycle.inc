namespace hp {

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
          if (FAILED(environment->QueryInterface(IID_PPV_ARGS(&environment10))) || !environment10) {
            target->controllerCreating = false;
            MarkSlotRecovering(*target, GetTickCount64());
            ArmRobustScheduler();
            return;
          }
          ComPtr<ICoreWebView2ControllerOptions> options;
          if (FAILED(environment10->CreateCoreWebView2ControllerOptions(&options)) || !options) {
            target->controllerCreating = false;
            MarkSlotRecovering(*target, GetTickCount64());
            ArmRobustScheduler();
            return;
          }
          const std::wstring profileName = std::wstring(kSpotifyProfilePrefix) +
              std::to_wstring(target->index + kSpotifyProfileFirstAccountNumber);
          if (FAILED(options->put_ProfileName(profileName.c_str())) ||
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
    // Keep the renderer active at all times. Background cost is controlled by
    // shrinking the host/controller surface to 1x1 instead of IsVisible=false.
    slot.controller->put_IsVisible(TRUE);

    ComPtr<ICoreWebView2Controller2> controller2;
    if (SUCCEEDED(slot.controller.As(&controller2)) && controller2) {
      COREWEBVIEW2_COLOR background{255, 0, 0, 0};
      controller2->put_DefaultBackgroundColor(background);
    }
    ComPtr<ICoreWebView2Settings> settings;
    if (SUCCEEDED(slot.webview->get_Settings(&settings)) && settings) {
      settings->put_IsScriptEnabled(TRUE);
      settings->put_IsWebMessageEnabled(TRUE);
      settings->put_AreDefaultScriptDialogsEnabled(FALSE);
      settings->put_AreDefaultContextMenusEnabled(FALSE);
      settings->put_AreDevToolsEnabled(FALSE);
      settings->put_IsStatusBarEnabled(FALSE);
      settings->put_AreHostObjectsAllowed(FALSE);
      settings->put_IsZoomControlEnabled(FALSE);
      settings->put_IsBuiltInErrorPageEnabled(TRUE);

      ComPtr<ICoreWebView2Settings3> settings3;
      if (SUCCEEDED(settings.As(&settings3)) && settings3) {
        settings3->put_AreBrowserAcceleratorKeysEnabled(FALSE);
      }
      ComPtr<ICoreWebView2Settings4> settings4;
      if (SUCCEEDED(settings.As(&settings4)) && settings4) {
        settings4->put_IsPasswordAutosaveEnabled(FALSE);
        settings4->put_IsGeneralAutofillEnabled(FALSE);
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

    Slot* const target = &slot;
    const auto alive = alive_;

    slot.webview->add_NavigationStarting(
        Callback<ICoreWebView2NavigationStartingEventHandler>(
            [this, alive, target](ICoreWebView2* sender, ICoreWebView2NavigationStartingEventArgs* args) -> HRESULT {
              if (!alive->load(std::memory_order_acquire) || !sender || !args) return S_OK;
              ++target->pageEpoch; if (target->pageEpoch == 0) ++target->pageEpoch;
              ++target->asyncEpoch; if (target->asyncEpoch == 0) ++target->asyncEpoch;
              target->asyncWork = AsyncWork::None;
              target->asyncStartedTick = 0;
              target->trustedClickBlockedUntilTick = 0;
              target->playerPage = false;
              target->loginPage = false;
              target->timedObserverReady = false;
              LPWSTR rawUri = nullptr;
              if (SUCCEEDED(args->get_Uri(&rawUri)) && rawUri) {
                target->playerPage = IsSpotifyPlayerUri(rawUri);
                target->loginPage = IsSpotifyLoginUri(rawUri);
                CoTaskMemFree(rawUri);
              }
              const ULONGLONG now = GetTickCount64();
              SetSlotState(*target, target->loginPage ? SlotState::Authenticating : SlotState::Navigating);
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
                target->playerPage = false;
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
              target->playerPage = playerPage;
              target->loginPage = loginPage;
              const ULONGLONG now = GetTickCount64();
              SetSlotState(*target, loginPage ? SlotState::Authenticating : (playerPage ? SlotState::WaitingTarget : SlotState::Navigating));
              target->nextRecoveryTick = playerPage || loginPage ? 0 : now + kSpotifyRecoveryRetryMs;
              RecomputeForeground();
              if (!playerPage) { ArmRobustScheduler(); return S_OK; }

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
                        PostSpotifyPageContext(*target);
                        ArmRobustScheduler();
                        return S_OK;
                      }).Get());
              if (FAILED(bootstrap)) {
                MarkSlotRecovering(*target, GetTickCount64());
                ArmRobustScheduler();
              }
              return S_OK;
            }).Get(), &slot.navigationCompletedToken);

    RECT client{};
    GetClientRect(slot.hostWindow, &client);
    slot.controller->put_Bounds(client);
    slot.controller->put_IsVisible(TRUE);
    SetSlotState(slot, SlotState::Authenticating);
    slot.webview->Navigate(kSpotifyLoginUrl);
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
