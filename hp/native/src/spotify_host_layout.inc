namespace hp {
namespace {

constexpr double kSpotifySerializedRecoveryZoom = 0.80;
constexpr int kSpotifyRecoveryInteractionWidth = 720;
constexpr int kSpotifyRecoveryInteractionHeight = 480;

bool SpotifyHostPositionEqual(const RECT& left, const RECT& right) noexcept {
  return left.left == right.left && left.top == right.top;
}

bool SpotifyHostSizeEqual(const RECT& left, const RECT& right) noexcept {
  return left.right - left.left == right.right - left.left &&
         left.bottom - left.top == right.bottom - right.top;
}

}  // namespace

void SpotifyWebViews::PlaceHosts() noexcept {
  if (!parentWindow_ || !IsWindow(parentWindow_) || slots_.empty()) return;

  RECT client{};
  if (!GetClientRect(parentWindow_, &client)) return;
  const int clientWidth = std::max(1L, client.right - client.left);
  const int clientHeight = std::max(1L, client.bottom - client.top);
  const int activeWidth = std::max(1, clientWidth * 3 / 5);
  const int activeHeight = std::max(1, clientHeight * 9 / 10);

  for (size_t i = 0; i < slots_.size(); ++i) {
    Slot& slot = slots_[i];
    if (!slot.hostWindow || !IsWindow(slot.hostWindow)) continue;

    const bool authentication =
        i == hostLayoutAuthenticationSlot_ && SlotIsLoginPage(slot);
    const bool recovery =
        i == hostLayoutActiveSlot_ && !authentication &&
        SlotStateNeedsRecovery(slot.state);

    // Steady background playback is a visible 1x1 surface. A recovery click is
    // the one short-lived exception: CDP trusted input needs a real viewport,
    // so the selected recovery slot expands offscreen only for that interaction
    // and returns to 1x1 as soon as it leaves Recovering.
    int x = client.left;
    int y = client.top;
    int width = 1;
    int height = 1;
    HWND insertAfter = HWND_BOTTOM;
    if (authentication) {
      x = client.left + (clientWidth - activeWidth) / 2;
      y = client.top + (clientHeight - activeHeight) / 2;
      width = activeWidth;
      height = activeHeight;
      insertAfter = HWND_TOP;
    } else if (recovery) {
      x = client.right + 32;
      y = client.top;
      width = kSpotifyRecoveryInteractionWidth;
      height = kSpotifyRecoveryInteractionHeight;
    }

    const RECT desired{x, y, x + width, y + height};
    const bool positionChanged =
        !slot.hostLayoutApplied ||
        !SpotifyHostPositionEqual(slot.hostLayoutRect, desired);
    const bool sizeChanged =
        !slot.hostLayoutApplied ||
        !SpotifyHostSizeEqual(slot.hostLayoutRect, desired);
    const bool zOrderChanged =
        !slot.hostLayoutApplied || slot.hostLayoutInsertAfter != insertAfter;
    const bool placementChanged = positionChanged || sizeChanged || zOrderChanged;
    const bool controllerChanged =
        slot.hostLayoutController != slot.controller.Get();

    if (placementChanged) {
      UINT flags = SWP_NOACTIVATE | SWP_SHOWWINDOW;
      if (!positionChanged) flags |= SWP_NOMOVE;
      if (!sizeChanged) flags |= SWP_NOSIZE;
      if (!zOrderChanged) flags |= SWP_NOZORDER;
      if (SetWindowPos(slot.hostWindow, insertAfter,
                       x, y, width, height, flags)) {
        slot.hostLayoutRect = desired;
        slot.hostLayoutInsertAfter = insertAfter;
        slot.hostLayoutApplied = true;
      }
    }

    if (!slot.controller) {
      slot.hostLayoutController = nullptr;
      slot.hostLayoutReducedZoomApplied = false;
      continue;
    }

    if (controllerChanged) {
      slot.hostLayoutController = slot.controller.Get();
      slot.hostLayoutReducedZoomApplied = false;
      slot.controller->put_IsVisible(TRUE);
    }

    const bool reducedZoom = authentication || recovery;
    if (slot.hostLayoutReducedZoomApplied != reducedZoom) {
      const HRESULT zoomResult = slot.controller->put_ZoomFactor(
          reducedZoom ? kSpotifySerializedRecoveryZoom : 1.0);
      if (SUCCEEDED(zoomResult)) {
        slot.hostLayoutReducedZoomApplied = reducedZoom;
      }
    }

    if (positionChanged || controllerChanged) {
      slot.controller->NotifyParentWindowPositionChanged();
    }
  }
}

void SpotifyWebViews::RefreshSpotifyHostLayout() noexcept {
  if (slots_.empty()) return;

  const size_t activeIndex = schedulerCursor_ % slots_.size();
  const size_t recoveryIndex =
      activeIndex < slots_.size() &&
      SlotStateNeedsRecovery(slots_[activeIndex].state) &&
      !SlotIsLoginPage(slots_[activeIndex])
          ? activeIndex
          : slots_.size();
  unsigned mask = 0;
  size_t foregroundAuthenticationIndex = slots_.size();
  for (size_t i = 0; i < slots_.size(); ++i) {
    if (!SlotStateIsHealthy(slots_[i].state)) mask |= (1u << i);
    if (foregroundAuthenticationIndex == slots_.size() && slots_[i].webview &&
        SlotIsLoginPage(slots_[i])) {
      foregroundAuthenticationIndex = i;
    }
  }

  const auto maintainAuthenticationForeground =
      [this, foregroundAuthenticationIndex](bool layoutChanged) noexcept {
        if (foregroundAuthenticationIndex >= slots_.size() || !parentWindow_ ||
            !IsWindow(parentWindow_)) {
          return;
        }
        Slot& slot = slots_[foregroundAuthenticationIndex];
        if (!slot.hostWindow || !IsWindow(slot.hostWindow) || !slot.webview ||
            !SlotIsLoginPage(slot)) {
          return;
        }

        if (!layoutChanged && GetWindow(slot.hostWindow, GW_HWNDPREV) != nullptr) {
          SetWindowPos(slot.hostWindow, HWND_TOP, 0, 0, 0, 0,
                       SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE |
                           SWP_SHOWWINDOW);
        }

        if (slot.authenticationBadgeTick != 0) return;
        slot.authenticationBadgeTick = 1;

        const auto alive = alive_;
        Slot* const target = &slot;
        const HRESULT started = slot.webview->ExecuteScript(
            kSpotifyAuthenticationBadgeBootstrapScript,
            Callback<ICoreWebView2ExecuteScriptCompletedHandler>(
                [this, alive, target](HRESULT result, LPCWSTR) -> HRESULT {
                  if (!alive->load(std::memory_order_acquire) || FAILED(result) ||
                      !started_ || !target->webview ||
                      !SlotIsLoginPage(*target)) {
                    if (alive->load(std::memory_order_acquire) && started_ &&
                        target->webview && SlotIsLoginPage(*target)) {
                      target->authenticationBadgeTick = 0;
                    }
                    return S_OK;
                  }
                  PostSpotifyPageContext(*target);
                  return S_OK;
                }).Get());
        if (FAILED(started)) slot.authenticationBadgeTick = 0;
      };

  if (hostLayoutMask_ == mask && hostLayoutActiveSlot_ == recoveryIndex &&
      hostLayoutAuthenticationSlot_ == foregroundAuthenticationIndex) {
    maintainAuthenticationForeground(false);
    return;
  }
  hostLayoutMask_ = mask;
  hostLayoutActiveSlot_ = recoveryIndex;
  hostLayoutAuthenticationSlot_ = foregroundAuthenticationIndex;
  PlaceHosts();
  maintainAuthenticationForeground(true);
}

}  // namespace hp
