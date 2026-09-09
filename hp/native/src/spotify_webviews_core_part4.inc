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
  slot.hostLayoutController = nullptr;
  slot.hostLayoutRect = {};
  slot.hostLayoutInsertAfter = nullptr;
  slot.hostLayoutApplied = false;
  slot.authenticationBadgeTick = 0;
  slot.environment.Reset();
  if (slot.hostWindow && IsWindow(slot.hostWindow)) DestroyWindow(slot.hostWindow);
  slot.hostWindow = nullptr;
  slot.controllerCreating = false;
  slot.controllerCreateTick = 0;
  ++slot.reconcileRequestGeneration;
  if (slot.reconcileRequestGeneration == 0) ++slot.reconcileRequestGeneration;
  slot.reconcileInFlight = false;
  slot.reconcileStartedTick = 0;
  ++slot.timedObserverInstallGeneration;
  if (slot.timedObserverInstallGeneration == 0) {
    ++slot.timedObserverInstallGeneration;
  }
  slot.timedObserverInstallStartedTick = 0;
  slot.trustedClickTargetGeneration = 0;
  slot.trustedClickBlockedUntilTick = 0;
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
  robustSchedulerStarted_ = false;
  staggerSlotIndex_ = 0;
  staggerSlotStartTick_ = 0;
  scheduleStartTick_ = 0;
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