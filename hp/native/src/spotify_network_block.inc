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
    return;
  }

  alive_ = std::make_shared<std::atomic<bool>>(true);
  schedulerWakePosted_.store(false, std::memory_order_release);
  timedRandomState_ = 0;
  for (Slot& slot : slots_) CreateHost(slot);
  Resize();
  StartAutonomousSchedule();
}

}  // namespace hp
