bool SpotifyWebViews::ParseCssPoint(
    LPCWSTR json, double* x, double* y) noexcept {
  if (!json || !x || !y) return false;
  try {
    const std::wstring value(json);
    if (value.size() < 5 || value.front() != L'[') return false;
    const size_t comma = value.find(L',');
    const size_t close = value.find(
        L']', comma == std::wstring::npos ? 0 : comma + 1);
    if (comma == std::wstring::npos || close == std::wstring::npos) return false;
    const double parsedX = std::stod(value.substr(1, comma - 1));
    const double parsedY = std::stod(value.substr(comma + 1, close - comma - 1));
    if (!(parsedX >= 0.0 && parsedX <= 100000.0) ||
        !(parsedY >= 0.0 && parsedY <= 100000.0)) {
      return false;
    }
    *x = parsedX;
    *y = parsedY;
    return true;
  } catch (...) {
    return false;
  }
}

void SpotifyWebViews::ClickSlotCssPoint(
    Slot& slot, double cssX, double cssY) noexcept {
  if (!slot.webview || !slot.hostWindow || !IsWindow(slot.hostWindow) ||
      !CurrentMusicTrack(slot)) {
    return;
  }

  // playbackConfirmed records the last proven start. After a later media
  // interruption the native observer moves the slot out of Playing, and the
  // trusted click path must be available again.
  if (slot.playbackConfirmed && slot.state == SlotState::Playing) {
    ArmRobustScheduler();
    return;
  }

  const bool recoveryViewportReady = SlotStateNeedsRecovery(slot.state);
  if (!recoveryViewportReady) {
    MarkSlotRecovering(slot, GetTickCount64());
    RefreshSpotifyHostLayout();
    ArmRobustScheduler();
    return;
  }

  RECT hostClient{};
  if (!GetClientRect(slot.hostWindow, &hostClient) ||
      hostClient.right - hostClient.left <= 1 ||
      hostClient.bottom - hostClient.top <= 1) {
    slot.hostLayoutApplied = false;
    PlaceHosts();
    ArmRobustScheduler();
    return;
  }

  const ULONGLONG targetGeneration = slot.targetGeneration;
  const ULONGLONG pageEpoch = slot.pageEpoch;
  const ULONGLONG stateProbeAt = GetTickCount64();
  SetSlotState(slot, SlotState::WaitingTarget);
  slot.nextRecoveryTick = stateProbeAt + kSpotifyPlaybackStateProbeMs;
  if (slot.trustedClickBlockedUntilTick != 0 &&
      stateProbeAt < slot.trustedClickBlockedUntilTick) {
    ArmRobustScheduler();
    return;
  }

  // The reconcile script already returned CSS viewport coordinates. Verify the
  // same point still resolves to a Spotify Play control, then return the exact
  // current button center. The returned coordinates are sent to CDP verbatim;
  // never reconstruct them from HWND pixels, DPI, or WebView zoom. This
  // preflight also owns the staged recovery policy: failed Play starts are
  // retried after five seconds, and the third attempt requests one page Reload
  // for this target generation before falling back to click-only retries.
  std::wstring preflight = L"(() => {";
  preflight += L"const x=" + std::to_wstring(cssX) + L";";
  preflight += L"const y=" + std::to_wstring(cssY) + L";";
  preflight +=
      std::wstring(L"const reloadUsed=") +
      (slot.playRecoveryReloadGeneration == targetGeneration ? L"true;" : L"false;");
  preflight +=
      L"if(!Number.isFinite(x)||!Number.isFinite(y)||"
      L"window.innerWidth<=0||window.innerHeight<=0||"
      L"x<0||x>window.innerWidth||y<0||y>window.innerHeight)return null;"
      L"const hit=document.elementFromPoint(x,y);"
      L"const button=hit&&hit.closest?hit.closest('button,[role=\"button\"]'):null;"
      L"if(!button||button.disabled||button.getAttribute('aria-disabled')==='true')return null;"
      L"const testid=((button.getAttribute('data-testid')||'').trim().toLowerCase());"
      L"const trustedPlay=testid==='play-button'||testid==='control-button-playpause';"
      L"if(!trustedPlay)return null;"
      L"const label=((button.getAttribute('aria-label')||button.getAttribute('title')||'').trim().toLowerCase());"
      L"if(label.includes('pause')||label.includes('一時停止'))return null;"
      L"const target=window.__homePanelSpotifyNativeTarget;"
      L"const targetPath=target&&(target.path||target.trackPath||target.pagePath||'');"
      L"if(!targetPath)return null;"
      L"let retry=window.__homePanelSpotifyNativePlayRetry;"
      L"if(!retry||retry.path!==targetPath){retry={path:targetPath,count:0,lastAttemptAt:0};window.__homePanelSpotifyNativePlayRetry=retry;}"
      L"const now=Date.now();"
      L"if(retry.lastAttemptAt&&now-retry.lastAttemptAt>30000){retry.count=0;retry.lastAttemptAt=0;}"
      L"if(window.__homePanelSpotifyZeroSecondRestartPath===targetPath){retry.count=0;retry.lastAttemptAt=0;}"
      L"if(retry.count>0&&now-retry.lastAttemptAt<5000)return null;"
      L"if(retry.count>=2){if(!reloadUsed)return 'reload';retry.count=0;}"
      L"const rect=button.getBoundingClientRect();"
      L"const centerX=rect.left+rect.width/2;"
      L"const centerY=rect.top+rect.height/2;"
      L"if(!Number.isFinite(centerX)||!Number.isFinite(centerY)||"
      L"centerX<0||centerX>window.innerWidth||"
      L"centerY<0||centerY>window.innerHeight)return null;"
      L"retry.count+=1;retry.lastAttemptAt=now;"
      L"return [centerX,centerY];})()";

  Slot* const target = &slot;
  ComPtr<ICoreWebView2> requestedView = slot.webview;
  const auto alive = alive_;
  const HRESULT started = requestedView->ExecuteScript(
      preflight.c_str(),
      Callback<ICoreWebView2ExecuteScriptCompletedHandler>(
          [this, alive, target, requestedView, targetGeneration, pageEpoch](
              HRESULT result, LPCWSTR json) -> HRESULT {
            if (!alive->load(std::memory_order_acquire) ||
                target->targetGeneration != targetGeneration ||
                target->pageEpoch != pageEpoch ||
                target->webview.Get() != requestedView.Get()) {
              return S_OK;
            }
            if (target->state == SlotState::Playing) {
              ArmRobustScheduler();
              return S_OK;
            }
            if (SUCCEEDED(result) && json &&
                std::wstring_view(json) == L"\"reload\"" &&
                target->playRecoveryReloadGeneration != targetGeneration) {
              target->playRecoveryReloadGeneration = targetGeneration;
              target->trustedClickBlockedUntilTick = 0;
              SetSlotState(*target, SlotState::Navigating);
              target->nextRecoveryTick =
                  GetTickCount64() + kSpotifyRecoveryRetryMs;
              if (FAILED(requestedView->Reload())) {
                MarkSlotRecovering(*target, GetTickCount64());
              }
              RecomputeForeground();
              ArmRobustScheduler();
              return S_OK;
            }
            double verifiedX = 0.0;
            double verifiedY = 0.0;
            if (SUCCEEDED(result) && ParseCssPoint(json, &verifiedX, &verifiedY)) {
              DispatchSpotifyDevToolsClick(*target, verifiedX, verifiedY);
            }
            ArmRobustScheduler();
            return S_OK;
          }).Get());
  if (FAILED(started)) ArmRobustScheduler();
}

UINT SpotifyWebViews::DispatchSpotifyDevToolsClick(
    Slot& slot, double cssX, double cssY) noexcept {
  try {
    if (!slot.webview || !slot.hostWindow || !IsWindow(slot.hostWindow) ||
        !CurrentMusicTrack(slot) ||
        !(cssX >= 0.0 && cssX <= 100000.0) ||
        !(cssY >= 0.0 && cssY <= 100000.0)) {
      return 0;
    }

    const ULONGLONG now = GetTickCount64();
    if (slot.trustedClickBlockedUntilTick != 0 &&
        now < slot.trustedClickBlockedUntilTick) {
      return 0;
    }

    // CDP Input.dispatchMouseEvent consumes CSS viewport coordinates. Use the
    // exact point verified in JavaScript; applying HWND DPI/raster/zoom scaling
    // here would move the click away from the Play control.
    const double x = cssX;
    const double y = cssY;
    const std::wstring moved =
        L"{\"type\":\"mouseMoved\",\"x\":" + std::to_wstring(x) +
        L",\"y\":" + std::to_wstring(y) + L"}";

    const ULONGLONG targetGeneration = slot.targetGeneration;
    const ULONGLONG pageEpoch = slot.pageEpoch;
    // Playback state is probed independently every two seconds. This five-second
    // window prevents duplicate trusted clicks while still allowing fast
    // recovery when a heavily loaded renderer drops the first Play gesture.
    slot.trustedClickBlockedUntilTick =
        now + kSpotifyCdpPlayRetryFailsafeMs;

    Slot* const target = &slot;
    const auto alive = alive_;
    ComPtr<ICoreWebView2> view = slot.webview;
    const HRESULT dispatched = view->CallDevToolsProtocolMethod(
        L"Input.dispatchMouseEvent", moved.c_str(),
        Callback<ICoreWebView2CallDevToolsProtocolMethodCompletedHandler>(
            [this, alive, target, view, x, y, targetGeneration, pageEpoch](
                HRESULT movedResult, LPCWSTR) -> HRESULT {
              if (!alive->load(std::memory_order_acquire) ||
                  target->targetGeneration != targetGeneration ||
                  target->pageEpoch != pageEpoch ||
                  target->webview.Get() != view.Get()) {
                return S_OK;
              }
              if (FAILED(movedResult) || !view) {
                target->trustedClickBlockedUntilTick = 0;
                return S_OK;
              }

              const std::wstring pressed =
                  L"{\"type\":\"mousePressed\",\"x\":" +
                  std::to_wstring(x) + L",\"y\":" + std::to_wstring(y) +
                  L",\"button\":\"left\",\"buttons\":1,\"clickCount\":1}";
              const HRESULT pressDispatched = view->CallDevToolsProtocolMethod(
                  L"Input.dispatchMouseEvent", pressed.c_str(),
                  Callback<ICoreWebView2CallDevToolsProtocolMethodCompletedHandler>(
                      [this, alive, target, view, x, y, targetGeneration,
                       pageEpoch](HRESULT pressedResult, LPCWSTR) -> HRESULT {
                        if (!alive->load(std::memory_order_acquire) ||
                            target->targetGeneration != targetGeneration ||
                            target->pageEpoch != pageEpoch ||
                            target->webview.Get() != view.Get()) {
                          return S_OK;
                        }
                        if (FAILED(pressedResult) || !view) {
                          target->trustedClickBlockedUntilTick = 0;
                          return S_OK;
                        }

                        const std::wstring released =
                            L"{\"type\":\"mouseReleased\",\"x\":" +
                            std::to_wstring(x) + L",\"y\":" +
                            std::to_wstring(y) +
                            L",\"button\":\"left\",\"buttons\":0,"
                            L"\"clickCount\":1}";
                        const HRESULT releaseDispatched =
                            view->CallDevToolsProtocolMethod(
                                L"Input.dispatchMouseEvent", released.c_str(),
                                Callback<ICoreWebView2CallDevToolsProtocolMethodCompletedHandler>(
                                    [](HRESULT, LPCWSTR) -> HRESULT {
                                      return S_OK;
                                    }).Get());
                        if (FAILED(releaseDispatched)) {
                          target->trustedClickBlockedUntilTick = 0;
                        }
                        return S_OK;
                      }).Get());
              if (FAILED(pressDispatched)) {
                target->trustedClickBlockedUntilTick = 0;
              }
              return S_OK;
            }).Get());
    if (FAILED(dispatched)) {
      slot.trustedClickBlockedUntilTick = 0;
      return 0;
    }
    return 1U;
  } catch (...) {
    return 0;
  }
}
