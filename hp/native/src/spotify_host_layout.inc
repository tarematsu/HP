namespace hp {
namespace {

constexpr double kSpotifySerializedRecoveryZoom = 0.80;
constexpr int kSpotifyParkedPlaybackWidth = 320;
constexpr int kSpotifyParkedPlaybackHeight = 180;
constexpr int kSpotifyParkedPlaybackGap = 8;
constexpr int kSpotifyRecoveryInteractionWidth = 720;
constexpr int kSpotifyRecoveryInteractionHeight = 480;

bool SpotifyHostPositionEqual(const RECT& left, const RECT& right) noexcept {
  return left.left == right.left && left.top == right.top;
}

bool SpotifyHostSizeEqual(const RECT& left, const RECT& right) noexcept {
  return left.right - left.left == right.right - right.left &&
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

    int x = client.right + 32 + static_cast<int>(i) *
        (kSpotifyParkedPlaybackWidth + kSpotifyParkedPlaybackGap);
    int y = client.top;
    int width = kSpotifyParkedPlaybackWidth;
    int height = kSpotifyParkedPlaybackHeight;
    HWND insertAfter = HWND_BOTTOM;
    if (authentication) {
      x = client.left + (clientWidth - activeWidth) / 2;
      y = client.top + (clientHeight - activeHeight) / 2;
      width = activeWidth;
      height = activeHeight;
      insertAfter = HWND_TOP;
    } else if (recovery) {
      // 0.80 recovery zoom makes these physical minimums at least a 900x600
      // CSS viewport, avoiding Spotify's compact control layout during input.
      x = client.right + 32 + static_cast<int>(slots_.size()) *
          (kSpotifyParkedPlaybackWidth + kSpotifyParkedPlaybackGap);
      y = client.top + (clientHeight - activeHeight) / 2;
      width = std::max(activeWidth, kSpotifyRecoveryInteractionWidth);
      height = std::max(activeHeight, kSpotifyRecoveryInteractionHeight);
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
      // Configure() already pushed initial bounds/visibility. Layout only needs
      // to remember the new controller and notify it of the parent position.
      slot.hostLayoutController = slot.controller.Get();
      slot.hostLayoutReducedZoomApplied = false;
    }

    const bool reducedZoom = authentication || recovery;
    if (slot.hostLayoutReducedZoomApplied != reducedZoom) {
      const HRESULT zoomResult = slot.controller->put_ZoomFactor(
          reducedZoom ? kSpotifySerializedRecoveryZoom : 1.0);
      if (SUCCEEDED(zoomResult)) {
        slot.hostLayoutReducedZoomApplied = reducedZoom;
      }
    }

    // A pure resize is already propagated by WM_SIZE. WebView2 only needs the
    // parent-position notification when the HWND actually moved or a controller
    // was newly attached.
    if (positionChanged || controllerChanged) {
      slot.controller->NotifyParentWindowPositionChanged();
    }
  }
}

void SpotifyWebViews::RefreshSpotifyHostLayout() noexcept {
  if (slots_.empty()) return;

  const size_t activeIndex = staggerSlotIndex_ % slots_.size();
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

        // Only repair z-order when another child actually moved above the auth
        // surface. A steady scheduler pass therefore costs no SetWindowPos call.
        if (!layoutChanged && GetWindow(slot.hostWindow, GW_HWNDPREV) != nullptr) {
          SetWindowPos(slot.hostWindow, HWND_TOP, 0, 0, 0, 0,
                       SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE |
                           SWP_SHOWWINDOW);
        }

        // The bridge is document-scoped and the account label is immutable for
        // the slot. Bootstrap once per navigation generation; retry only after a
        // failed ExecuteScript instead of polling it every scheduler pass.
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
