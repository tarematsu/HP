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

    // A hard network block cannot rely on the stopped Spotify scheduler to
    // flush a coalesced update, so publish this availability change immediately.
    playbackTelemetryDirty_ = true;
    lastPlaybackTelemetryPostTick_ = 0;
    MaybePostPlaybackTelemetryChanged(GetTickCount64());
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
    slot.lastModeNavigateTick = 0;
    slot.lastTimedReconcileTick = 0;
    slot.unhealthySinceTick = 0;
    slot.state = SlotState::NotCreated;
    slot.playerPage = false;
    slot.loginPage = false;
    slot.timedRotationCycle = 0;
    slot.timedRotationPosition = 0;
    slot.timedCompletionDeadlineTick = 0;
    slot.timedCompletionDeadlineGeneration = 0;
    slot.timedInterruptionStartTick = 0;
    slot.timedRotationActive = false;
    slot.lastPlaybackStartedAt = 0;
    slot.reconcileInFlight = false;
    slot.targetGeneration = 0;
    if (!CreateHost(slot)) continue;
  }

  if (!slots_.empty() && slots_[0].hostWindow) {
    CreateController(slots_[0]);
  }
  Resize();
  StartAutonomousSchedule(GetTickCount64());
  NotifyPlaybackTelemetryChanged();
}

}  // namespace hp