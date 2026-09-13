namespace hp {

void SpotifyWebViews::SetNetworkBlocked(bool blocked) noexcept {
  if (networkBlocked_ == blocked) return;
  networkBlocked_ = blocked;
  if (!started_) return;

  if (blocked) {
    if (schedulerTimer_) SetThreadpoolTimer(schedulerTimer_, nullptr, 0, 0);
    schedulerWakePosted_.store(false, std::memory_order_release);

    if (alive_) alive_->store(false, std::memory_order_release);
    for (Slot& slot : slots_) CloseSlot(slot);
    robustSchedulerStarted_ = false;
    schedulerCursor_ = 0;
    scheduleStartTick_ = 0;
    hostLayoutMask_ = ~0u;
    hostLayoutActiveSlot_ = kAccountCount;
    hostLayoutAuthenticationSlot_ = kAccountCount;
    return;
  }

  alive_ = std::make_shared<std::atomic<bool>>(true);
  robustSchedulerStarted_ = false;
  schedulerWakePosted_.store(false, std::memory_order_release);
  schedulerCursor_ = 0;
  scheduleStartTick_ = 0;
  timedRandomState_ = 0;
  hostLayoutMask_ = ~0u;
  hostLayoutActiveSlot_ = kAccountCount;
  hostLayoutAuthenticationSlot_ = kAccountCount;

  for (Slot& slot : slots_) {
    slot.controllerCreating = false;
    slot.controllerCreateTick = 0;
    slot.nextRecoveryTick = 0;
    ++slot.asyncEpoch;
    if (slot.asyncEpoch == 0) ++slot.asyncEpoch;
    ++slot.pageEpoch;
    if (slot.pageEpoch == 0) ++slot.pageEpoch;
    slot.asyncWork = AsyncWork::None;
    slot.asyncStartedTick = 0;
    slot.state = SlotState::NotCreated;
    slot.playerPage = false;
    slot.loginPage = false;
    slot.timedObserverReady = false;
    slot.timedRotationCycle = 0;
    slot.timedRotationPosition = 0;
    slot.timedCompletionDeadlineTick = 0;
    slot.timedCompletionDeadlineGeneration = 0;
    slot.trustedClickBlockedUntilTick = 0;
    slot.timedRotationActive = false;
    slot.targetGeneration = 0;
    if (!CreateHost(slot)) continue;
  }

  if (!slots_.empty() && slots_[0].hostWindow) {
    CreateController(slots_[0]);
  }
  Resize();
  StartAutonomousSchedule(GetTickCount64());
}

}  // namespace hp
