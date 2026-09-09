namespace hp {
namespace {

constexpr double kSpotifySerializedRecoveryZoom = 0.80;
constexpr int kSpotifyParkedPlaybackWidth = 320;
constexpr int kSpotifyParkedPlaybackHeight = 180;
constexpr int kSpotifyParkedPlaybackGap = 8;
constexpr int kSpotifyRecoveryInteractionWidth = 720;
constexpr int kSpotifyRecoveryInteractionHeight = 480;
constexpr ULONGLONG kSpotifyAuthenticationBadgeRefreshMs = 30ULL * 1000ULL;

bool SpotifyHostRectEqual(const RECT& left, const RECT& right) noexcept {
  return left.left == right.left && left.top == right.top &&
         left.right == right.right && left.bottom == right.bottom;
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
    const bool placementChanged =
        !slot.hostLayoutApplied ||
        !SpotifyHostRectEqual(slot.hostLayoutRect, desired) ||
        slot.hostLayoutInsertAfter != insertAfter;
    const bool controllerChanged =
        slot.hostLayoutController != slot.controller.Get();

    if (placementChanged) {
      ShowWindow(slot.hostWindow, SW_SHOWNOACTIVATE);
      if (SetWindowPos(slot.hostWindow, insertAfter,
                       x, y, width, height,
                       SWP_NOACTIVATE | SWP_SHOWWINDOW)) {
        slot.hostLayoutRect = desired;
        slot.hostLayoutInsertAfter = insertAfter;
        slot.hostLayoutApplied = true;
      }
    }

    if (!slot.controller) {
      slot.hostLayoutController = nullptr;
      continue;
    }

    // WM_SIZE owns normal bounds propagation after a real resize. Only a newly
    // attached controller needs an explicit initial bounds push here. Position
    // changes still need the lightweight parent-position notification.
    if (controllerChanged) {
      RECT bounds{};
      GetClientRect(slot.hostWindow, &bounds);
      slot.controller->put_Bounds(bounds);
      slot.controller->put_IsVisible(TRUE);
      slot.hostLayoutController = slot.controller.Get();
    }
    if (placementChanged || controllerChanged) {
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

  if (recoveryIndex < slots_.size() && slots_[recoveryIndex].controller) {
    double zoom = 1.0;
    if (FAILED(slots_[recoveryIndex].controller->get_ZoomFactor(&zoom)) ||
        zoom < 0.799 || zoom > 0.801) {
      slots_[recoveryIndex].controller->put_ZoomFactor(
          kSpotifySerializedRecoveryZoom);
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

        // PlaceHosts already applies geometry and HWND_TOP on a layout change.
        // On steady scheduler passes only refresh z-order, not geometry or all
        // WebView2 bounds, so one login surface cannot stall the six-window set.
        if (!layoutChanged) {
          SetWindowPos(slot.hostWindow, HWND_TOP, 0, 0, 0, 0,
                       SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE |
                           SWP_SHOWWINDOW);
        }

        if (layoutChanged && slot.controller) {
          double zoom = 1.0;
          if (FAILED(slot.controller->get_ZoomFactor(&zoom)) ||
              zoom < 0.799 || zoom > 0.801) {
            slot.controller->put_ZoomFactor(kSpotifySerializedRecoveryZoom);
          }
        }

        const ULONGLONG now = GetTickCount64();
        if (!layoutChanged && slot.authenticationBadgeTick != 0 &&
            now - slot.authenticationBadgeTick <
                kSpotifyAuthenticationBadgeRefreshMs) {
          return;
        }
        slot.authenticationBadgeTick = now;

        const auto alive = alive_;
        Slot* const target = &slot;
        slot.webview->ExecuteScript(
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
