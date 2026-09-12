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
  if (!slot.webview || !slot.hostWindow || !IsWindow(slot.hostWindow)) return;

  // Parked surfaces are playback-only. Expanding a responsive page invalidates
  // coordinates measured at 320x180, so the first pass only promotes recovery
  // ownership. The next settled reconcile obtains a fresh point before click.
  const bool recoveryViewportReady =
      hostLayoutActiveSlot_ == slot.index && SlotStateNeedsRecovery(slot.state);
  if (!recoveryViewportReady) {
    const ULONGLONG now = GetTickCount64();
    MarkSlotRecovering(slot, now);
    slot.lastTimedReconcileTick = 0;
    staggerSlotIndex_ = slot.index;
    staggerSlotStartTick_ = now;
    staggerSlotValidated_ = false;
    RefreshSpotifyHostLayout();
    ArmRobustScheduler();
    return;
  }

  SetSlotState(slot, SlotState::WaitingTarget);

  // The point was measured asynchronously. Spotify can switch a Play-labelled
  // control to Pause before native input reaches it. Revalidate both playback
  // state and the element currently under the point immediately before CDP
  // input; a stale point is discarded instead of becoming an accidental pause.
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
      L"const label=((button.getAttribute('aria-label')||button.getAttribute('title')||'').trim().toLowerCase());"
      L"if(!label||label.includes('pause')||label.includes('一時停止'))return false;"
      L"return label==='play'||label==='再生'||label.startsWith('play ')||label.endsWith('を再生');"
      L"})()";

  const ULONGLONG targetGeneration = slot.targetGeneration;
  Slot* const target = &slot;
  ComPtr<ICoreWebView2> requestedView = slot.webview;
  const auto alive = alive_;
  const HRESULT started = requestedView->ExecuteScript(
      preflight.c_str(),
      Callback<ICoreWebView2ExecuteScriptCompletedHandler>(
          [this, alive, target, requestedView, targetGeneration,
           xTenThousandths, yTenThousandths](HRESULT result, LPCWSTR json)
              -> HRESULT {
            if (!alive->load(std::memory_order_acquire) ||
                target->targetGeneration != targetGeneration ||
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
    if (!slot.webview || !slot.hostWindow || !IsWindow(slot.hostWindow)) return 0;

    // One native gate covers both in-flight suppression and the post-click
    // cooldown. A lost callback simply ages out; a target change bypasses the
    // old gate immediately.
    constexpr ULONGLONG kSpotifyTrustedClickGateMs = 8ULL * 1000ULL;
    const ULONGLONG now = GetTickCount64();
    const ULONGLONG targetGeneration = slot.targetGeneration;
    if (slot.trustedClickTargetGeneration == targetGeneration &&
        slot.trustedClickBlockedUntilTick != 0 &&
        now < slot.trustedClickBlockedUntilTick) {
      return 0;
    }

    RECT client{};
    if (!GetClientRect(slot.hostWindow, &client)) return 0;
    const int width = client.right - client.left;
    const int height = client.bottom - client.top;
    if (width <= 1 || height <= 1) return 0;

    // CDP Input.dispatchMouseEvent consumes CSS viewport coordinates. WebView2
    // ZoomFactor changes the CSS viewport size without changing the host bounds.
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

    ++slot.trustedClickGeneration;
    if (slot.trustedClickGeneration == 0) ++slot.trustedClickGeneration;
    const ULONGLONG clickGeneration = slot.trustedClickGeneration;
    slot.trustedClickTargetGeneration = targetGeneration;
    slot.trustedClickBlockedUntilTick = now + kSpotifyTrustedClickGateMs;

    Slot* const target = &slot;
    const auto alive = alive_;
    ComPtr<ICoreWebView2> view = slot.webview;
    const HRESULT dispatched = view->CallDevToolsProtocolMethod(
        L"Input.dispatchMouseEvent", moved.c_str(),
        Callback<ICoreWebView2CallDevToolsProtocolMethodCompletedHandler>(
            [alive, target, view, x, y, clickGeneration, targetGeneration](
                HRESULT movedResult, LPCWSTR) -> HRESULT {
              if (!alive->load(std::memory_order_acquire) ||
                  target->trustedClickGeneration != clickGeneration ||
                  target->targetGeneration != targetGeneration ||
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
                      [alive, target, view, x, y, clickGeneration,
                       targetGeneration](HRESULT pressedResult, LPCWSTR)
                          -> HRESULT {
                        if (!alive->load(std::memory_order_acquire) ||
                            target->trustedClickGeneration != clickGeneration ||
                            target->targetGeneration != targetGeneration ||
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
                        view->CallDevToolsProtocolMethod(
                            L"Input.dispatchMouseEvent", released.c_str(),
                            Callback<ICoreWebView2CallDevToolsProtocolMethodCompletedHandler>(
                                [alive, target, view, clickGeneration,
                                 targetGeneration](HRESULT, LPCWSTR) -> HRESULT {
                                  if (!alive->load(std::memory_order_acquire) ||
                                      target->trustedClickGeneration !=
                                          clickGeneration ||
                                      target->targetGeneration !=
                                          targetGeneration ||
                                      target->webview.Get() != view.Get()) {
                                    return S_OK;
                                  }
                                  return S_OK;
                                }).Get());
                        return S_OK;
                      }).Get());
              if (FAILED(pressDispatched) &&
                  target->trustedClickGeneration == clickGeneration &&
                  target->targetGeneration == targetGeneration) {
                target->trustedClickBlockedUntilTick = 0;
              }
              return S_OK;
            }).Get());
    if (FAILED(dispatched)) {
      if (slot.trustedClickGeneration == clickGeneration &&
          slot.targetGeneration == targetGeneration) {
        slot.trustedClickBlockedUntilTick = 0;
      }
      return 0;
    }
    return 1U;
  } catch (...) {
    return 0;
  }
}
