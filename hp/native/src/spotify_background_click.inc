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
  if (slot.playbackConfirmed && slot.nativeAudioStartVerified &&
      slot.state == SlotState::Playing) {
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
  const ULONGLONG now = GetTickCount64();
  SetSlotState(slot, SlotState::WaitingTarget);
  slot.nextRecoveryTick = now + kSpotifyPlaybackStateProbeMs;
  if (slot.trustedClickBlockedUntilTick != 0 &&
      now < slot.trustedClickBlockedUntilTick) {
    ArmRobustScheduler();
    return;
  }

  // The startup probe issues only one Play request per page. Revalidate that the
  // returned point still resolves to a Spotify Play control, then dispatch one
  // trusted CDP click. Failure is handled later by the ordinary startup checks;
  // there is no click retry/reload/rebuild ladder here.
  std::wstring preflight = L"(() => {";
  preflight += L"const x=" + std::to_wstring(cssX) + L";";
  preflight += L"const y=" + std::to_wstring(cssY) + L";";
  preflight +=
      L"if(!Number.isFinite(x)||!Number.isFinite(y)||"
      L"window.innerWidth<=0||window.innerHeight<=0||"
      L"x<0||x>window.innerWidth||y<0||y>window.innerHeight)return null;"
      L"const target=window.__homePanelSpotifyNativeTarget;"
      L"const targetPath=target&&(target.path||target.trackPath||target.pagePath||'');"
      L"if(!targetPath||location.hostname!=='open.spotify.com')return null;"
      L"const hit=document.elementFromPoint(x,y);"
      L"const button=hit&&hit.closest?hit.closest('button,[role=\"button\"]'):null;"
      L"if(!button||button.disabled||button.getAttribute('aria-disabled')==='true')return null;"
      L"const testid=((button.getAttribute('data-testid')||'').trim().toLowerCase());"
      L"if(testid!=='play-button'&&testid!=='control-button-playpause')return null;"
      L"const label=((button.getAttribute('aria-label')||button.getAttribute('title')||'').trim().toLowerCase());"
      L"if(label.includes('pause')||label.includes('一時停止'))return null;"
      L"const rect=button.getBoundingClientRect();"
      L"const centerX=rect.left+rect.width/2;"
      L"const centerY=rect.top+rect.height/2;"
      L"if(!Number.isFinite(centerX)||!Number.isFinite(centerY)||"
      L"centerX<0||centerX>window.innerWidth||"
      L"centerY<0||centerY>window.innerHeight)return null;"
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

    const double x = cssX;
    const double y = cssY;
    const std::wstring moved =
        L"{\"type\":\"mouseMoved\",\"x\":" + std::to_wstring(x) +
        L",\"y\":" + std::to_wstring(y) + L"}";

    const ULONGLONG targetGeneration = slot.targetGeneration;
    const ULONGLONG pageEpoch = slot.pageEpoch;
    slot.trustedClickBlockedUntilTick = now + kSpotifyCdpPlayRetryFailsafeMs;

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
