namespace hp {
namespace {

constexpr double kSpotifySurfaceZoom = 0.50;

bool SpotifyHostPositionEqual(const RECT& left, const RECT& right) noexcept {
  return left.left == right.left && left.top == right.top;
}

bool SpotifyHostSizeEqual(const RECT& left, const RECT& right) noexcept {
  return left.right - left.left == right.right - right.left &&
         left.bottom - left.top == right.bottom - right.top;
}

bool SpotifyMediaPanelRect(HWND parentWindow, RECT* rect) noexcept {
  if (!parentWindow || !rect) return false;
  const HWND mediaWindow = FindWindowExW(
      parentWindow, nullptr, L"HomePanelNativeStaticPanel",
      L"HomePanelNativeMedia");
  if (!mediaWindow || !IsWindow(mediaWindow)) return false;

  RECT screenRect{};
  if (!GetWindowRect(mediaWindow, &screenRect)) return false;
  POINT topLeft{screenRect.left, screenRect.top};
  POINT bottomRight{screenRect.right, screenRect.bottom};
  if (!ScreenToClient(parentWindow, &topLeft) ||
      !ScreenToClient(parentWindow, &bottomRight)) {
    return false;
  }

  RECT clientRect{topLeft.x, topLeft.y, bottomRight.x, bottomRight.y};
  if (clientRect.right <= clientRect.left ||
      clientRect.bottom <= clientRect.top) {
    return false;
  }
  *rect = clientRect;
  return true;
}

}  // namespace

void SpotifyWebViews::SetMonitorForeground(bool foreground) noexcept {
  if (monitorForeground_ == foreground) return;
  monitorForeground_ = foreground;
  for (Slot& slot : slots_) slot.hostLayoutApplied = false;
  PlaceHosts();
}

void SpotifyWebViews::PlaceHosts() noexcept {
  if (!parentWindow_ || !IsWindow(parentWindow_) || slots_.empty()) return;

  RECT client{};
  if (!GetClientRect(parentWindow_, &client)) return;
  const int clientWidth = std::max(1L, client.right - client.left);
  const int clientHeight = std::max(1L, client.bottom - client.top);
  const int activeWidth = std::max(1, clientWidth * 3 / 5);
  const int activeHeight = std::max(1, clientHeight * 9 / 10);

  RECT mediaPanelRect = client;
  SpotifyMediaPanelRect(parentWindow_, &mediaPanelRect);
  const int mediaPanelWidth =
      std::max(1L, mediaPanelRect.right - mediaPanelRect.left);
  const int mediaPanelHeight =
      std::max(1L, mediaPanelRect.bottom - mediaPanelRect.top);

  for (size_t i = 0; i < slots_.size(); ++i) {
    Slot& slot = slots_[i];
    if (!slot.hostWindow || !IsWindow(slot.hostWindow)) continue;

    const bool authentication =
        i == hostLayoutAuthenticationSlot_ && SlotIsLoginPage(slot);
    const bool compactPlayback =
        slot.playbackConfirmed && CurrentMusicTrack(slot) != nullptr;

    // Keep background Spotify exactly underneath the existing YouTube/TVer
    // panel before playback is confirmed. This preserves a normal responsive
    // viewport for trusted CDP clicks without exposing Spotify through gaps in
    // the surrounding native dashboard. Once playback starts, keep the renderer
    // alive at 1x1 until that target song finishes (including any mid-song ad
    // interruption). Monitor C remains the explicit full-size foreground
    // inspection mode. Authentication keeps its existing foreground surface so
    // login remains usable. The WebView itself always stays zoomed out.
    int x = mediaPanelRect.left;
    int y = mediaPanelRect.top;
    int width = compactPlayback ? 1 : mediaPanelWidth;
    int height = compactPlayback ? 1 : mediaPanelHeight;
    HWND insertAfter = HWND_BOTTOM;
    if (monitorForeground_) {
      x = client.left;
      y = client.top;
      width = clientWidth;
      height = clientHeight;
      insertAfter = HWND_TOP;
    } else if (authentication) {
      x = client.left + (clientWidth - activeWidth) / 2;
      y = client.top + (clientHeight - activeHeight) / 2;
      width = activeWidth;
      height = activeHeight;
      insertAfter = HWND_TOP;
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

    constexpr bool reducedZoom = true;
    if (slot.hostLayoutReducedZoomApplied != reducedZoom) {
      if (SUCCEEDED(slot.controller->put_ZoomFactor(kSpotifySurfaceZoom))) {
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
        if (monitorForeground_ || foregroundAuthenticationIndex >= slots_.size() ||
            !parentWindow_ || !IsWindow(parentWindow_)) {
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
