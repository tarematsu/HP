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

  for (Slot& slot : slots_) CreateHost(slot);

  Resize();
  StartAutonomousSchedule(GetTickCount64());
}

}  // namespace hp
