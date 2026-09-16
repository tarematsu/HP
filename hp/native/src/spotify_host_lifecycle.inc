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

  RECT client{};
  if (!GetClientRect(parentWindow_, &client)) return false;
  const int width = std::max(1L, client.right - client.left);
  const int height = std::max(1L, client.bottom - client.top);
  slot.hostWindow = CreateWindowExW(
      0, kSpotifyHostClass, L"Spotify", WS_CHILD | WS_CLIPSIBLINGS,
      client.left, client.top, width, height,
      parentWindow_, nullptr, GetModuleHandleW(nullptr), &slot);
  const bool created = slot.hostWindow && IsWindow(slot.hostWindow);
  if (created) {
    HWND schedulerHost = schedulerHost_.load(std::memory_order_acquire);
    if (!schedulerHost || !IsWindow(schedulerHost)) {
      schedulerHost_.store(slot.hostWindow, std::memory_order_release);
      schedulerWakePosted_.store(false, std::memory_order_release);
    }
  }
  return created;
}

void SpotifyWebViews::Start() noexcept {
  if (started_ || !parentWindow_ || !IsWindow(parentWindow_)) return;

  alive_ = std::make_shared<std::atomic<bool>>(true);
  started_ = true;

  for (Slot& slot : slots_) CloseSlot(slot);
  ResetSpotifyRuntimeLanes();
  for (Slot& slot : slots_) {
    if (SpotifyAccountShouldOwnHost(slot.index)) CreateHost(slot);
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
  const HWND closingHost = slot.hostWindow;
  const bool wasSchedulerHost =
      closingHost && schedulerHost_.load(std::memory_order_acquire) == closingHost;
  if (wasSchedulerHost) {
    schedulerHost_.store(nullptr, std::memory_order_release);
    schedulerWakePosted_.store(false, std::memory_order_release);
  }
  UnsubscribeMediaPipelineErrors(slot.mediaErrorReceiver, slot.mediaErrorToken);
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
  slot.mediaErrorToken = {};
  slot.timedEndHandlerWebview = nullptr;
  slot.webview.Reset();
  if (slot.controller) slot.controller->Close();
  slot.controller.Reset();
  slot.hostLayoutController = nullptr;
  slot.hostLayoutRect = {};
  slot.hostLayoutInsertAfter = nullptr;
  slot.hostLayoutApplied = false;
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
  slot.nextProcessTitlePollTick = 0;
  slot.trustedClickBlockedUntilTick = 0;
  slot.playRecoveryReloadGeneration = 0;
  slot.playRecoveryRecreateGeneration = 0;
  slot.mediaPipelineRecoveryGeneration = 0;
  slot.memoryUsageTargetLevel = -1;
  slot.timedRotationCycle = 0;
  slot.timedRotationPosition = 0;
  slot.timedCompletionDeadlineTick = 0;
  slot.timedCompletionDeadlineGeneration = 0;
  slot.timedRotationActive = false;
  slot.targetGeneration = 0;
  slot.state = SlotState::NotCreated;
  slot.loginPage = false;
  slot.timedObserverReady = false;
  slot.observedTrackTitle.clear();
  slot.processTrackDisplay.clear();
  slot.processTitleObservedAt = {};
  slot.playbackConfirmed = false;
  slot.processTitleObserved = false;
  slot.mediaPipelineRecoveryPending = false;
  slot.playbackConfirmedAt = {};

  if (wasSchedulerHost) {
    for (const Slot& candidate : slots_) {
      if (candidate.hostWindow && IsWindow(candidate.hostWindow)) {
        schedulerHost_.store(candidate.hostWindow, std::memory_order_release);
        break;
      }
    }
  }
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
  alive_->store(false, std::memory_order_release);
  for (Slot& slot : slots_) CloseSlot(slot);
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
    if (message == kSpotifySchedulerMessage && slot->owner &&
        slot->owner->schedulerHost_.load(std::memory_order_acquire) == hwnd) {
      SpotifyWebViews* const owner = slot->owner;
      owner->schedulerWakePosted_.store(false, std::memory_order_release);
      if (owner->started_ && !owner->networkBlocked_) {
        owner->RunStaggeredReconcile();
        owner->ArmRobustScheduler();
      }
      return 0;
    }
    if (message == WM_SIZE && slot->controller) {
      slot->controller->put_Bounds(
          SpotifyControllerBounds(hwnd, slot->loginPage));
      return 0;
    }
    if (message == WM_NCDESTROY) {
      if (slot->owner &&
          slot->owner->schedulerHost_.load(std::memory_order_acquire) == hwnd) {
        slot->owner->schedulerHost_.store(nullptr, std::memory_order_release);
        slot->owner->schedulerWakePosted_.store(false, std::memory_order_release);
      }
      if (slot->hostWindow == hwnd) slot->hostWindow = nullptr;
      SetWindowLongPtrW(hwnd, GWLP_USERDATA, 0);
    }
  }
  return DefWindowProcW(hwnd, message, wparam, lparam);
}

}  // namespace hp
