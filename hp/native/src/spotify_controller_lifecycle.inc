namespace hp {

void SpotifyWebViews::CreateController(Slot& slot) noexcept {
  if (!slot.hostWindow || !IsWindow(slot.hostWindow) ||
      slot.controller || slot.webview) {
    return;
  }
  SetSlotState(slot, SlotState::NotCreated);
  slot.controllerCreating = true;
  slot.controllerCreateTick = GetTickCount64();
  const auto alive = alive_;
  Slot* const target = &slot;
  try {
    SharedWebViewEnvironment::Instance().Acquire(
        userDataFolder_, false, false,
        [this, alive, target](HRESULT result,
                              ICoreWebView2Environment* environment) {
          if (!alive->load(std::memory_order_acquire)) return;
          if (FAILED(result) || !environment || !target->hostWindow ||
              !IsWindow(target->hostWindow)) {
            target->controllerCreating = false;
            target->controllerCreateTick = 0;
            MarkSlotRecovering(*target, GetTickCount64());
            return;
          }
          target->environment = environment;

          ComPtr<ICoreWebView2Environment10> environment10;
          if (FAILED(environment->QueryInterface(IID_PPV_ARGS(&environment10))) ||
              !environment10) {
            target->controllerCreating = false;
            target->controllerCreateTick = 0;
            MarkSlotRecovering(*target, GetTickCount64());
            return;
          }
          ComPtr<ICoreWebView2ControllerOptions> options;
          if (FAILED(environment10->CreateCoreWebView2ControllerOptions(&options)) ||
              !options) {
            target->controllerCreating = false;
            target->controllerCreateTick = 0;
            MarkSlotRecovering(*target, GetTickCount64());
            return;
          }
          const std::wstring profileName =
              std::wstring(kSpotifyProfilePrefix) +
              std::to_wstring(target->index + 1);
          if (FAILED(options->put_ProfileName(profileName.c_str())) ||
              FAILED(options->put_IsInPrivateModeEnabled(FALSE))) {
            target->controllerCreating = false;
            target->controllerCreateTick = 0;
            MarkSlotRecovering(*target, GetTickCount64());
            return;
          }

          const auto ready =
              Callback<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler>(
                  [this, alive, target](HRESULT controllerResult,
                                        ICoreWebView2Controller* controller)
                      -> HRESULT {
                    if (!alive->load(std::memory_order_acquire)) {
                      if (controller) controller->Close();
                      return S_OK;
                    }
                    target->controllerCreating = false;
                    target->controllerCreateTick = 0;
                    if (FAILED(controllerResult) || !controller ||
                        !target->hostWindow || !IsWindow(target->hostWindow)) {
                      if (controller) controller->Close();
                      MarkSlotRecovering(*target, GetTickCount64());
                      return S_OK;
                    }
                    target->controller = controller;
                    target->controller->get_CoreWebView2(&target->webview);
                    if (!target->webview) {
                      target->controller->Close();
                      target->controller.Reset();
                      MarkSlotRecovering(*target, GetTickCount64());
                      return S_OK;
                    }
                    Configure(*target);
                    return S_OK;
                  });

          const HRESULT createResult =
              environment10->CreateCoreWebView2ControllerWithOptions(
                  target->hostWindow, options.Get(), ready.Get());
          if (FAILED(createResult)) {
            target->controllerCreating = false;
            target->controllerCreateTick = 0;
            MarkSlotRecovering(*target, GetTickCount64());
          }
        });
  } catch (...) {
    slot.controllerCreating = false;
    slot.controllerCreateTick = 0;
    MarkSlotRecovering(slot, GetTickCount64());
  }
}

void SpotifyWebViews::Configure(Slot& slot) noexcept {
  if (!slot.controller || !slot.webview) return;
  try {
    SetSpotifyOutputMuted(slot.webview);
    ComPtr<ICoreWebView2Controller2> controller2;
    if (SUCCEEDED(slot.controller.As(&controller2)) && controller2) {
      COREWEBVIEW2_COLOR background{255, 0, 0, 0};
      controller2->put_DefaultBackgroundColor(background);
    }
    ComPtr<ICoreWebView2Settings> settings;
    if (SUCCEEDED(slot.webview->get_Settings(&settings)) && settings) {
      settings->put_IsScriptEnabled(TRUE);
      settings->put_IsWebMessageEnabled(TRUE);
      settings->put_AreDefaultScriptDialogsEnabled(TRUE);
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
    }

    Slot* const target = &slot;
    const auto alive = alive_;
    slot.webview->AddWebResourceRequestedFilter(
        L"*", COREWEBVIEW2_WEB_RESOURCE_CONTEXT_IMAGE);
    slot.webview->AddWebResourceRequestedFilter(
        L"*", COREWEBVIEW2_WEB_RESOURCE_CONTEXT_FONT);
    slot.webview->add_WebResourceRequested(
        Callback<ICoreWebView2WebResourceRequestedEventHandler>(
            [alive, target](ICoreWebView2*,
                            ICoreWebView2WebResourceRequestedEventArgs* args)
                -> HRESULT {
              if (!alive->load(std::memory_order_acquire) || !args ||
                  !target->playerPage || !target->environment) {
                return S_OK;
              }
              ComPtr<ICoreWebView2WebResourceResponse> response;
              if (SUCCEEDED(target->environment->CreateWebResourceResponse(
                      nullptr, 204, L"No Content",
                      L"Cache-Control: no-store\r\n", &response)) && response) {
                args->put_Response(response.Get());
              }
              return S_OK;
            }).Get(),
        &slot.webResourceRequestedToken);

    slot.webview->add_NavigationStarting(
        Callback<ICoreWebView2NavigationStartingEventHandler>(
            [this, alive, target](ICoreWebView2*,
                                  ICoreWebView2NavigationStartingEventArgs* args)
                -> HRESULT {
              if (!alive->load(std::memory_order_acquire) || !args) return S_OK;
              // Navigation replaces the page document, not the requested
              // rotation target. Keep targetGeneration stable so a Spotify
              // redirect/reload cannot invalidate the native A -> B completion
              // deadline. Only invalidate async work tied to the old document.
              ++target->reconcileRequestGeneration;
              if (target->reconcileRequestGeneration == 0) {
                ++target->reconcileRequestGeneration;
              }
              target->reconcileInFlight = false;
              target->reconcileStartedTick = 0;
              ++target->timedObserverInstallGeneration;
              if (target->timedObserverInstallGeneration == 0) {
                ++target->timedObserverInstallGeneration;
              }
              target->timedObserverInstallStartedTick = 0;
              ++target->trustedClickGeneration;
              if (target->trustedClickGeneration == 0) {
                ++target->trustedClickGeneration;
              }
              target->trustedClickTargetGeneration = 0;
              target->trustedClickBlockedUntilTick = 0;
              target->playerPage = false;
              target->loginPage = false;
              target->authenticationBadgeTick = 0;
              target->timedObserverReady = false;
              target->timedObserverInstallInFlight = false;
              LPWSTR rawUri = nullptr;
              if (SUCCEEDED(args->get_Uri(&rawUri)) && rawUri) {
                target->playerPage = IsSpotifyPlayerUri(rawUri);
                target->loginPage = IsSpotifyLoginUri(rawUri);
                CoTaskMemFree(rawUri);
              }
              SetSlotState(*target, target->loginPage
                  ? SlotState::Authenticating
                  : SlotState::Navigating);
              RecomputeForeground();
              return S_OK;
            }).Get(),
        &slot.navigationStartingToken);

    slot.webview->add_NavigationCompleted(
        Callback<ICoreWebView2NavigationCompletedEventHandler>(
            [this, alive, target](ICoreWebView2* sender,
                                  ICoreWebView2NavigationCompletedEventArgs* args)
                -> HRESULT {
              if (!alive->load(std::memory_order_acquire) || !sender || !args) {
                return S_OK;
              }
              SetSpotifyOutputMuted(target->webview);
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
              SetSlotState(*target, loginPage
                  ? SlotState::Authenticating
                  : (playerPage ? SlotState::WaitingTarget
                                : SlotState::Navigating));
              RecomputeForeground();
              if (!playerPage) {
                ArmRobustScheduler();
                return S_OK;
              }

              const HRESULT bootstrap = sender->ExecuteScript(
                  kSpotifyStaticPageBootstrapScript,
                  Callback<ICoreWebView2ExecuteScriptCompletedHandler>(
                      [this, alive, target](HRESULT result, LPCWSTR) -> HRESULT {
                        if (!alive->load(std::memory_order_acquire) ||
                            FAILED(result) || !started_ || !target->webview) {
                          if (alive->load(std::memory_order_acquire) &&
                              started_ && target->webview) {
                            MarkSlotRecovering(*target, GetTickCount64());
                            ArmRobustScheduler();
                          }
                          return S_OK;
                        }
                        PostSpotifyPageContext(*target);
                        return S_OK;
                      }).Get());
              if (FAILED(bootstrap)) {
                MarkSlotRecovering(*target, GetTickCount64());
                ArmRobustScheduler();
              }
              return S_OK;
            }).Get(),
        &slot.navigationCompletedToken);

    RECT client{};
    GetClientRect(slot.hostWindow, &client);
    slot.controller->put_Bounds(client);
    // Keeping WebView2 visible avoids background suspension. The HWND itself is
    // parked outside the dashboard when this slot does not own recovery.
    slot.controller->put_IsVisible(TRUE);
    SetSlotState(slot, SlotState::Authenticating);
    slot.webview->Navigate(kSpotifyLoginUrl);
  } catch (...) {
    MarkSlotRecovering(slot, GetTickCount64());
  }
}

bool SpotifyWebViews::IsSpotifyPlayerUri(const wchar_t* uri) noexcept {
  if (!uri) return false;
  const std::wstring_view value(uri);
  return StartsWithInsensitive(value, L"https://open.spotify.com/") &&
         !StartsWithInsensitive(value, L"https://open.spotify.com/login");
}

bool SpotifyWebViews::IsSpotifyLoginUri(const wchar_t* uri) noexcept {
  if (!uri) return false;
  const std::wstring_view value(uri);
  return StartsWithInsensitive(value, L"https://accounts.spotify.com/") ||
         StartsWithInsensitive(value, L"https://open.spotify.com/login");
}

}  // namespace hp
