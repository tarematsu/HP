bool SpotifyWebViews::ParseNormalizedPoint(
    LPCWSTR json, int* x, int* y) noexcept {
  if (!json || !x || !y) return false;
  try {
    const std::wstring value(json);
    if (value.size() < 5 || value.front() != L'[') return false;
    const size_t comma = value.find(L',');
    const size_t close = value.find(
        L']', comma == std::wstring::npos ? 0 : comma + 1);
    if (comma == std::wstring::npos || close == std::wstring::npos) return false;
    const int parsedX = std::stoi(value.substr(1, comma - 1));
    const int parsedY = std::stoi(value.substr(comma + 1, close - comma - 1));
    if (parsedX < 0 || parsedX > 10000 || parsedY < 0 || parsedY > 10000) {
      return false;
    }
    *x = parsedX;
    *y = parsedY;
    return true;
  } catch (...) {
    return false;
  }
}

void SpotifyWebViews::ClickSlotNormalizedPoint(
    Slot& slot, int xTenThousandths, int yTenThousandths) noexcept {
  if (!slot.webview || !slot.hostWindow || !IsWindow(slot.hostWindow) ||
      !CurrentMusicTrack(slot)) {
    return;
  }

  if (slot.playbackConfirmed) {
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

  if (!slot.timedObserverReady) {
    ArmTimedEndObserver(slot);
  }

  const ULONGLONG targetGeneration = slot.targetGeneration;
  const ULONGLONG pageEpoch = slot.pageEpoch;
  SetSlotState(slot, SlotState::WaitingTarget);

  std::wstring preflight = L"(() => {";
  preflight += L"const nx=" + std::to_wstring(xTenThousandths) + L";";
  preflight += L"const ny=" + std::to_wstring(yTenThousandths) + L";";
  preflight +=
      L"const media=Array.from(document.querySelectorAll('audio, video'));"
      L"if(media.some(m=>!m.ended&&!m.paused))return false;"
      L"if(window.innerWidth<=0||window.innerHeight<=0)return false;"
      L"const x=window.innerWidth*nx/10000;"
      L"const y=window.innerHeight*ny/10000;"
      L"const hit=document.elementFromPoint(x,y);"
      L"const button=hit&&hit.closest?hit.closest('button,[role=\"button\"]'):null;"
      L"if(!button||button.disabled||button.getAttribute('aria-disabled')==='true')return false;"
      L"const testid=((button.getAttribute('data-testid')||'').trim().toLowerCase());"
      L"const trustedPlay=testid==='play-button'||testid==='control-button-playpause';"
      L"if(!trustedPlay)return false;"
      L"const runtime=window.__homePanelSpotifyMediaObserverRuntime;"
      L"if(runtime&&typeof runtime.armTrustedStart==='function'){"
      L"runtime.armTrustedStart('" + std::to_wstring(targetGeneration) + L"');}"
      L"return true;})()";

  Slot* const target = &slot;
  ComPtr<ICoreWebView2> requestedView = slot.webview;
  const auto alive = alive_;
  const HRESULT started = requestedView->ExecuteScript(
      preflight.c_str(),
      Callback<ICoreWebView2ExecuteScriptCompletedHandler>(
          [this, alive, target, requestedView, targetGeneration, pageEpoch,
           xTenThousandths, yTenThousandths](HRESULT result, LPCWSTR json)
              -> HRESULT {
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
                std::wstring_view(json) == L"true") {
              DispatchSpotifyDevToolsClick(
                  *target, xTenThousandths, yTenThousandths);
            }
            ArmRobustScheduler();
            return S_OK;
          }).Get());
  if (FAILED(started)) ArmRobustScheduler();
}

UINT SpotifyWebViews::DispatchSpotifyDevToolsClick(
    Slot& slot, int xTenThousandths, int yTenThousandths) noexcept {
  try {
    if (!slot.webview || !slot.hostWindow || !IsWindow(slot.hostWindow) ||
        !CurrentMusicTrack(slot)) {
      return 0;
    }

    const ULONGLONG now = GetTickCount64();
    if (slot.trustedClickBlockedUntilTick != 0 &&
        now < slot.trustedClickBlockedUntilTick) {
      return 0;
    }

    RECT client{};
    if (!GetClientRect(slot.hostWindow, &client)) return 0;
    const int width = client.right - client.left;
    const int height = client.bottom - client.top;
    if (width <= 1 || height <= 1) return 0;

    double zoom = 1.0;
    if (slot.controller) {
      double controllerZoom = 1.0;
      if (SUCCEEDED(slot.controller->get_ZoomFactor(&controllerZoom)) &&
          controllerZoom > 0.05) {
        zoom = controllerZoom;
      }
    }
    const double cssWidth = static_cast<double>(width) / zoom;
    const double cssHeight = static_cast<double>(height) / zoom;
    const double rawX = cssWidth * xTenThousandths / 10000.0;
    const double rawY = cssHeight * yTenThousandths / 10000.0;
    const double x = std::max(0.0, std::min(cssWidth - 1.0, rawX));
    const double y = std::max(0.0, std::min(cssHeight - 1.0, rawY));

    const std::wstring moved =
        L"{\"type\":\"mouseMoved\",\"x\":" + std::to_wstring(x) +
        L",\"y\":" + std::to_wstring(y) + L"}";

    const ULONGLONG targetGeneration = slot.targetGeneration;
    const ULONGLONG pageEpoch = slot.pageEpoch;
    slot.trustedClickBlockedUntilTick = now + kSpotifyCdpPlayConfirmWaitMs;

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
