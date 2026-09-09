                                  ICoreWebView2NavigationStartingEventArgs* args)
                -> HRESULT {
              if (!alive->load(std::memory_order_acquire) || !args) return S_OK;
              // Navigation creates a new document generation. Any observer,
              // reconcile result, or trusted click still arriving from the
              // previous document must not mutate the new one.
              BumpSpotifyTargetGeneration(*target);
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
              target->playerPage = false;
              target->loginPage = false;
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

void SpotifyWebViews::RecomputeForeground() noexcept {
  RefreshSpotifyHostLayout();
}

void SpotifyWebViews::Resize() noexcept {
  hostLayoutMask_ = ~0u;
  hostLayoutActiveSlot_ = kAccountCount;
  hostLayoutAuthenticationSlot_ = kAccountCount;
  RefreshSpotifyHostLayout();
}

