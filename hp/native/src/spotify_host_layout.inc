namespace hp {
namespace {

constexpr double kSpotifySerializedRecoveryZoom = 0.80;
constexpr int kSpotifyParkedPlaybackWidth = 320;
constexpr int kSpotifyParkedPlaybackHeight = 180;
constexpr int kSpotifyParkedPlaybackGap = 8;
constexpr int kSpotifyRecoveryInteractionWidth = 720;
constexpr int kSpotifyRecoveryInteractionHeight = 480;

}  // namespace

void SpotifyWebViews::PlaceHosts() noexcept {
  if (!parentWindow_ || !IsWindow(parentWindow_) || slots_.empty()) return;

  RECT client{};
  if (!GetClientRect(parentWindow_, &client)) return;
  const int clientWidth = std::max(1L, client.right - client.left);
  const int clientHeight = std::max(1L, client.bottom - client.top);
  const int activeWidth = std::max(1, clientWidth * 3 / 5);
  const int activeHeight = std::max(1, clientHeight * 9 / 10);

  HDWP batch = BeginDeferWindowPos(static_cast<int>(slots_.size()));
  for (size_t i = 0; i < slots_.size(); ++i) {
    Slot& slot = slots_[i];
    if (!slot.hostWindow || !IsWindow(slot.hostWindow)) continue;
    if (slot.controller) slot.controller->put_IsVisible(TRUE);

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

    ShowWindow(slot.hostWindow, SW_SHOWNOACTIVATE);
    const UINT flags = SWP_NOACTIVATE | SWP_SHOWWINDOW;
    if (batch) {
      batch = DeferWindowPos(batch, slot.hostWindow, insertAfter,
                             x, y, width, height, flags);
    } else {
      SetWindowPos(slot.hostWindow, insertAfter,
                   x, y, width, height, flags);
    }
  }
  if (batch) EndDeferWindowPos(batch);

  for (Slot& slot : slots_) {
    if (!slot.hostWindow || !IsWindow(slot.hostWindow) || !slot.controller) {
      continue;
    }
    RECT bounds{};
    GetClientRect(slot.hostWindow, &bounds);
    slot.controller->put_Bounds(bounds);
    slot.controller->NotifyParentWindowPositionChanged();
    slot.controller->put_IsVisible(TRUE);
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
      [this, foregroundAuthenticationIndex](bool refreshGeometry) noexcept {
        if (foregroundAuthenticationIndex >= slots_.size() || !parentWindow_ ||
            !IsWindow(parentWindow_)) {
          return;
        }
        Slot& slot = slots_[foregroundAuthenticationIndex];
        if (!slot.hostWindow || !IsWindow(slot.hostWindow) || !slot.webview ||
            !SlotIsLoginPage(slot)) {
          return;
        }

        if (refreshGeometry) {
          RECT client{};
          if (!GetClientRect(parentWindow_, &client)) return;
          const int clientWidth = std::max(1L, client.right - client.left);
          const int clientHeight = std::max(1L, client.bottom - client.top);
          const int width = std::max(1, clientWidth * 3 / 5);
          const int height = std::max(1, clientHeight * 9 / 10);
          const int x = client.left + (clientWidth - width) / 2;
          const int y = client.top + (clientHeight - height) / 2;

          SetWindowPos(slot.hostWindow, HWND_TOP, x, y, width, height,
                       SWP_NOACTIVATE | SWP_SHOWWINDOW);
          if (slot.controller) {
            double zoom = 1.0;
            if (FAILED(slot.controller->get_ZoomFactor(&zoom)) ||
                zoom < 0.799 || zoom > 0.801) {
              slot.controller->put_ZoomFactor(kSpotifySerializedRecoveryZoom);
            }
            RECT bounds{};
            GetClientRect(slot.hostWindow, &bounds);
            slot.controller->put_Bounds(bounds);
            slot.controller->NotifyParentWindowPositionChanged();
            slot.controller->put_IsVisible(TRUE);
          }
        } else {
          SetWindowPos(slot.hostWindow, HWND_TOP, 0, 0, 0, 0,
                       SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE |
                           SWP_SHOWWINDOW);
        }

        const auto alive = alive_;
        Slot* const target = &slot;
        slot.webview->ExecuteScript(
            kSpotifyAuthenticationBadgeBootstrapScript,
            Callback<ICoreWebView2ExecuteScriptCompletedHandler>(
                [this, alive, target](HRESULT result, LPCWSTR) -> HRESULT {
                  if (!alive->load(std::memory_order_acquire) || FAILED(result) ||
                      !started_ || !target->webview ||
                      !SlotIsLoginPage(*target)) {
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
