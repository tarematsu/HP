namespace hp {
namespace {

constexpr double kSpotifySerializedRecoveryZoom = 0.80;

}  // namespace

void SpotifyWebViews::RefreshSpotifyHostLayout() noexcept {
  if (slots_.empty()) return;

  const size_t activeIndex = staggerSlotIndex_ % slots_.size();
  unsigned mask = 0;
  size_t foregroundAuthenticationIndex = slots_.size();
  for (size_t i = 0; i < slots_.size(); ++i) {
    if (!SlotStateIsHealthy(slots_[i].state)) mask |= (1u << i);
    if (foregroundAuthenticationIndex == slots_.size() && slots_[i].webview &&
        SlotIsLoginPage(slots_[i])) {
      foregroundAuthenticationIndex = i;
    }
  }

  if (activeIndex < slots_.size() && slots_[activeIndex].controller) {
    double zoom = 1.0;
    if (FAILED(slots_[activeIndex].controller->get_ZoomFactor(&zoom)) ||
        zoom < 0.799 || zoom > 0.801) {
      slots_[activeIndex].controller->put_ZoomFactor(kSpotifySerializedRecoveryZoom);
    }
  }

  const auto maintainAuthenticationForeground =
      [this, foregroundAuthenticationIndex]() noexcept {
        if (foregroundAuthenticationIndex >= slots_.size() || !parentWindow_ ||
            !IsWindow(parentWindow_)) {
          return;
        }
        Slot& slot = slots_[foregroundAuthenticationIndex];
        if (!slot.hostWindow || !IsWindow(slot.hostWindow) || !slot.webview ||
            !SlotIsLoginPage(slot)) {
          return;
        }

        RECT client{};
        if (!GetClientRect(parentWindow_, &client)) return;
        const int clientWidth = std::max(1L, client.right - client.left);
        const int clientHeight = std::max(1L, client.bottom - client.top);
        const int width = std::max(1, clientWidth * 3 / 5);
        const int height = std::max(1, clientHeight * 9 / 10);
        const int x = client.left + (clientWidth - width) / 2;
        const int y = client.top + (clientHeight - height) / 2;

        // Authentication owns only the visible surface. Playback and recovery
        // scheduling for the other accounts continue independently behind it.
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

  // Cache the actual authentication owner rather than a visibility boolean.
  // If auth moves from one account to another, this forces PlaceHosts() to park
  // the old host before the new login surface is brought to the foreground.
  if (hostLayoutMask_ == mask && hostLayoutActiveSlot_ == activeIndex &&
      hostLayoutAuthenticationSlot_ == foregroundAuthenticationIndex) {
    maintainAuthenticationForeground();
    return;
  }
  hostLayoutMask_ = mask;
  hostLayoutActiveSlot_ = activeIndex;
  hostLayoutAuthenticationSlot_ = foregroundAuthenticationIndex;
  PlaceHosts();
  maintainAuthenticationForeground();
}

}  // namespace hp
