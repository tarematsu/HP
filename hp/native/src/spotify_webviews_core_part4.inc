void SpotifyWebViews::PlaceHosts() noexcept {
  if (!parentWindow_ || !IsWindow(parentWindow_) || slots_.empty()) return;

  RECT client{};
  if (!GetClientRect(parentWindow_, &client)) return;
  const int clientWidth = std::max(1L, client.right - client.left);
  const int clientHeight = std::max(1L, client.bottom - client.top);
  const int activeWidth = std::max(1, clientWidth * 3 / 5);
  const int activeHeight = std::max(1, clientHeight * 9 / 10);
  constexpr int kSpotifyParkedPlaybackWidth = 320;
  constexpr int kSpotifyParkedPlaybackHeight = 180;
  constexpr int kSpotifyParkedPlaybackGap = 8;

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

    // A 1x1 WebView can make Chromium/Spotify treat a background player as
    // effectively occluded and suspend its media pipeline. Keep every account
    // alive in a small, distinct offscreen viewport; only a slot that currently
    // needs recovery is expanded for reliable responsive DOM interaction.
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
      // Give only the recovery owner a normal CSS viewport, but keep it offscreen
      // beyond the six stable playback parking surfaces.
      x = client.right + 32 + static_cast<int>(slots_.size()) *
          (kSpotifyParkedPlaybackWidth + kSpotifyParkedPlaybackGap);
      y = client.top + (clientHeight - activeHeight) / 2;
      width = activeWidth;
      height = activeHeight;
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

void SpotifyWebViews::CloseSlot(Slot& slot) noexcept {
  if (slot.index == 0 && slot.hostWindow && IsWindow(slot.hostWindow)) {
    KillTimer(slot.hostWindow, kSpotifyRobustReconcileTimer);
  }
  if (slot.webview) {
    if (slot.navigationStartingToken.value != 0) {
      slot.webview->remove_NavigationStarting(slot.navigationStartingToken);
    }
    if (slot.navigationCompletedToken.value != 0) {
      slot.webview->remove_NavigationCompleted(slot.navigationCompletedToken);
    }
    if (slot.webMessageReceivedToken.value != 0) {
      slot.webview->remove_WebMessageReceived(slot.webMessageReceivedToken);
    }
    if (slot.webResourceRequestedToken.value != 0) {
      slot.webview->remove_WebResourceRequested(slot.webResourceRequestedToken);
    }
    if (slot.timedEndMessageReceivedToken.value != 0) {
      slot.webview->remove_WebMessageReceived(slot.timedEndMessageReceivedToken);
    }
  }
  slot.navigationStartingToken = {};
  slot.navigationCompletedToken = {};
  slot.webMessageReceivedToken = {};
  slot.webResourceRequestedToken = {};
  slot.timedEndMessageReceivedToken = {};
  slot.timedEndHandlerWebview = nullptr;
  slot.webview.Reset();
  if (slot.controller) slot.controller->Close();
  slot.controller.Reset();
  slot.environment.Reset();
  if (slot.hostWindow && IsWindow(slot.hostWindow)) DestroyWindow(slot.hostWindow);
  slot.hostWindow = nullptr;
  slot.controllerCreating = false;
  slot.controllerCreateTick = 0;
  slot.reconcileInFlight = false;
  slot.trustedClickInFlight = false;
  slot.trustedClickStartTick = 0;
  slot.state = SlotState::NotCreated;
  slot.unhealthySinceTick = 0;
  slot.playerPage = false;
  slot.loginPage = false;
  slot.timedObserverReady = false;
  slot.timedObserverInstallInFlight = false;
}

void SpotifyWebViews::Shutdown() noexcept {
  if (!started_) return;
  started_ = false;
  alive_->store(false, std::memory_order_release);
  for (Slot& slot : slots_) CloseSlot(slot);
  podcastMode_ = false;
  robustSchedulerStarted_ = false;
  staggerSlotIndex_ = 0;
  staggerSlotStartTick_ = 0;
  youtubeCycleStartTick_ = 0;
}

LRESULT CALLBACK SpotifyWebViews::HostWndProc(
    HWND hwnd, UINT message, WPARAM wparam, LPARAM lparam) {
  Slot* slot = reinterpret_cast<Slot*>(GetWindowLongPtrW(hwnd, GWLP_USERDATA));
  if (message == WM_NCCREATE) {
    auto* create = reinterpret_cast<CREATESTRUCTW*>(lparam);
    slot = reinterpret_cast<Slot*>(create->lpCreateParams);
    SetWindowLongPtrW(hwnd, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(slot));
  }
  if (slot) {
    if (message == WM_SIZE && slot->controller) {
      RECT client{};
      GetClientRect(hwnd, &client);
      slot->controller->put_Bounds(client);
      return 0;
    }
    if (message == WM_NCDESTROY) {
      if (slot->hostWindow == hwnd) slot->hostWindow = nullptr;
      SetWindowLongPtrW(hwnd, GWLP_USERDATA, 0);
    }
  }
  return DefWindowProcW(hwnd, message, wparam, lparam);
}

}  // namespace hp
