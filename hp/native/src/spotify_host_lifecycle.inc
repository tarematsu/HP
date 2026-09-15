namespace hp {

bool SpotifyWebViews::EnsureHostClass() noexcept {
  static std::once_flag once;
  static bool registered = false;
  try {
    std::call_once(once, [] {
      WNDCLASSW windowClass{};
      windowClass.lpfnWndProc = &SpotifyWebViews::HostWndProc;
      windowClass.hInstance = GetModuleHandleW(nullptr);
      windowClass.lpszClassName = kSpotifyHostClass;
      windowClass.hCursor = LoadCursorW(nullptr, IDC_ARROW);
      windowClass.hbrBackground =
          static_cast<HBRUSH>(GetStockObject(BLACK_BRUSH));
      SetLastError(ERROR_SUCCESS);
      registered = RegisterClassW(&windowClass) != 0 ||
                   GetLastError() == ERROR_CLASS_ALREADY_EXISTS;
    });
  } catch (...) {
    return false;
  }
  return registered;
}

bool SpotifyWebViews::CreateHost(Slot& slot) noexcept {
  if (slot.hostWindow && IsWindow(slot.hostWindow)) return true;
  if (!parentWindow_ || !IsWindow(parentWindow_) || !EnsureHostClass()) return false;
  slot.hostWindow = CreateWindowExW(
      0, kSpotifyHostClass, L"Spotify", WS_CHILD | WS_CLIPSIBLINGS,
      0, 0, 1, 1, parentWindow_, nullptr, GetModuleHandleW(nullptr), &slot);
  const bool created = slot.hostWindow && IsWindow(slot.hostWindow);
  if (created && slot.index == 0) {
    schedulerHost_.store(slot.hostWindow, std::memory_order_release);
  }
  return created;
}

void SpotifyWebViews::Start() noexcept {
  if (started_ || !parentWindow_ || !IsWindow(parentWindow_)) return;

  alive_ = std::make_shared<std::atomic<bool>>(true);
  started_ = true;
  robustSchedulerStarted_ = false;
  schedulerHost_.store(nullptr, std::memory_order_release);
  schedulerWakePosted_.store(false, std::memory_order_release);
  schedulerCursor_ = 0;
  scheduleStartTick_ = 0;
  hostLayoutMask_ = ~0u;
  hostLayoutActiveSlot_ = kAccountCount;
  hostLayoutAuthenticationSlot_ = kAccountCount;

  for (Slot& slot : slots_) {
    slot.state = SlotState::NotCreated;
    slot.targetGeneration = 0;
    slot.nextRecoveryTick = 0;
    slot.asyncEpoch = 0;
    slot.asyncStartedTick = 0;
    slot.pageEpoch = 0;
    slot.asyncWork = AsyncWork::None;
    slot.playerPage = false;
    slot.loginPage = false;
    slot.timedObserverReady = false;
    slot.controllerCreating = false;
    slot.controllerCreateTick = 0;
    slot.timedRotationCycle = 0;
    slot.timedRotationPosition = 0;
    slot.timedCompletionDeadlineTick = 0;
    slot.timedCompletionDeadlineGeneration = 0;
    slot.trustedClickBlockedUntilTick = 0;
    slot.timedRotationActive = false;
    slot.observedTrackTitle.clear();
    slot.playbackConfirmed = false;
    slot.playbackConfirmedAt = {};
    if (!CreateHost(slot)) continue;
  }

  Resize();
  StartAutonomousSchedule(GetTickCount64());
}

void SpotifyWebViews::RecomputeForeground() noexcept {
  RefreshSpotifyHostLayout();
}

void SpotifyWebViews::Resize() noexcept {
  hostLayoutMask_ = ~0u;
  hostLayoutActiveSlot_ = kAccountCount;
  hostLayoutAuthenticationSlot_ = kAccountCount;
  RefreshSpotifyHostLayout();
}

void SpotifyWebViews::CloseSlot(Slot& slot) noexcept {
  if (slot.index == 0) {
    schedulerHost_.store(nullptr, std::memory_order_release);
    schedulerWakePosted_.store(false, std::memory_order_release);
  }
  if (slot.webview) {
    if (slot.navigationStartingToken.value != 0) {
      slot.webview->remove_NavigationStarting(slot.navigationStartingToken);
    }
    if (slot.navigationCompletedToken.value != 0) {
      slot.webview->remove_NavigationCompleted(slot.navigationCompletedToken);
    }
    if (slot.timedEndMessageReceivedToken.value != 0) {
      slot.webview->remove_WebMessageReceived(slot.timedEndMessageReceivedToken);
    }
  }
  slot.navigationStartingToken = {};
  slot.navigationCompletedToken = {};
  slot.timedEndMessageReceivedToken = {};
  slot.timedEndHandlerWebview = nullptr;
  slot.webview.Reset();
  if (slot.controller) slot.controller->Close();
  slot.controller.Reset();
  slot.hostLayoutController = nullptr;
  slot.hostLayoutRect = {};
  slot.hostLayoutInsertAfter = nullptr;
  slot.hostLayoutApplied = false;
  slot.hostLayoutReducedZoomApplied = false;
  slot.environment.Reset();
  if (slot.hostWindow && IsWindow(slot.hostWindow)) DestroyWindow(slot.hostWindow);
  slot.hostWindow = nullptr;
  slot.controllerCreating = false;
  slot.controllerCreateTick = 0;
  ++slot.asyncEpoch;
  if (slot.asyncEpoch == 0) ++slot.asyncEpoch;
  ++slot.pageEpoch;
  if (slot.pageEpoch == 0) ++slot.pageEpoch;
  slot.asyncWork = AsyncWork::None;
  slot.asyncStartedTick = 0;
  slot.nextRecoveryTick = 0;
  slot.trustedClickBlockedUntilTick = 0;
  slot.timedRotationCycle = 0;
  slot.timedRotationPosition = 0;
  slot.timedCompletionDeadlineTick = 0;
  slot.timedCompletionDeadlineGeneration = 0;
  slot.timedRotationActive = false;
  slot.targetGeneration = 0;
  slot.state = SlotState::NotCreated;
  slot.playerPage = false;
  slot.loginPage = false;
  slot.timedObserverReady = false;
  slot.observedTrackTitle.clear();
  slot.playbackConfirmed = false;
  slot.playbackConfirmedAt = {};
}

void SpotifyWebViews::Shutdown() noexcept {
  if (!started_) return;
  started_ = false;
  if (schedulerTimer_) {
    SetThreadpoolTimer(schedulerTimer_, nullptr, 0, 0);
    WaitForThreadpoolTimerCallbacks(schedulerTimer_, TRUE);
    CloseThreadpoolTimer(schedulerTimer_);
    schedulerTimer_ = nullptr;
  }
  schedulerWakePosted_.store(false, std::memory_order_release);
  alive_->store(false, std::memory_order_release);
  for (Slot& slot : slots_) CloseSlot(slot);
  robustSchedulerStarted_ = false;
  schedulerCursor_ = 0;
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
    if (message == kSpotifySchedulerMessage && slot->index == 0 && slot->owner) {
      SpotifyWebViews* const owner = slot->owner;
      owner->schedulerWakePosted_.store(false, std::memory_order_release);
      if (owner->started_ && !owner->networkBlocked_) {
        owner->RunStaggeredReconcile();
        owner->ArmRobustScheduler();
      }
      return 0;
    }
    if (message == WM_SIZE && slot->controller) {
      RECT client{};
      GetClientRect(hwnd, &client);
      slot->controller->put_Bounds(client);
      return 0;
    }
    if (message == WM_NCDESTROY) {
      if (slot->index == 0 && slot->owner) {
        slot->owner->schedulerHost_.store(nullptr, std::memory_order_release);
      }
      if (slot->hostWindow == hwnd) slot->hostWindow = nullptr;
      SetWindowLongPtrW(hwnd, GWLP_USERDATA, 0);
    }
  }
  return DefWindowProcW(hwnd, message, wparam, lparam);
}

}  // namespace hp
