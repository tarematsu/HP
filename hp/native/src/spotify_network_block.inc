namespace hp {

void SpotifyWebViews::SetNetworkBlocked(bool blocked) noexcept {
  if (networkBlocked_ == blocked) return;
  networkBlocked_ = blocked;
  if (!started_) return;

  if (blocked) {
    // Invalidate every outstanding async controller/environment callback before
    // destroying the six WebViews. Old callbacks retain this false generation
    // even after unmute creates a fresh shared flag.
    if (alive_) alive_->store(false, std::memory_order_release);
    for (Slot& slot : slots_) CloseSlot(slot);
    robustSchedulerStarted_ = false;
    staggerSlotIndex_ = 0;
    staggerSlotStartTick_ = 0;
    youtubeCycleStartTick_ = 0;
    staggerSlotValidated_ = false;
    hostLayoutMask_ = ~0u;
    hostLayoutActiveSlot_ = kAccountCount;
    hostLayoutAuthenticationVisible_ = false;
    return;
  }

  alive_ = std::make_shared<std::atomic<bool>>(true);
  robustSchedulerStarted_ = false;
  staggerSlotIndex_ = 0;
  staggerSlotStartTick_ = 0;
  youtubeCycleStartTick_ = 0;
  timedRandomState_ = 0;
  timedRandomPairCycle_ = ~0ULL;
  timedBridgeCatalogIndex_ = kNoTimedCatalogIndex;
  timedRandomCIndex_ = kNoTimedCatalogIndex;
  timedRandomDIndex_ = kNoTimedCatalogIndex;
  staggerSlotValidated_ = false;
  hostLayoutMask_ = ~0u;
  hostLayoutActiveSlot_ = kAccountCount;
  hostLayoutAuthenticationVisible_ = false;

  for (Slot& slot : slots_) {
    slot.controllerCreating = false;
    slot.controllerCreateTick = 0;
    slot.lastModeNavigateTick = 0;
    slot.lastTimedReconcileTick = 0;
    slot.unhealthySinceTick = 0;
    slot.state = SlotState::NotCreated;
    slot.playerPage = false;
    slot.loginPage = false;
    slot.podcastCompleted = false;
    slot.timedTarget = TimedSpotifyTarget::None;
    slot.timedCatalogIndex = kNoTimedCatalogIndex;
    slot.timedRotationCycle = 0;
    slot.timedRotationPosition = 0;
      slot.timedPlaybackStartTick = 0;
    slot.timedRandomCIndex = kNoTimedCatalogIndex;
    slot.timedRandomDIndex = kNoTimedCatalogIndex;
    slot.timedRotationActive = false;
    slot.timedPreludeCompleted = false;
    slot.timedBridgeCompleted = false;
    slot.reconcileInFlight = false;
    slot.targetGeneration = 0;
    if (!CreateHost(slot)) continue;
  }

  if (!slots_.empty() && slots_[0].hostWindow) {
    CreateController(slots_[0]);
  }
  Resize();
}

}  // namespace hp
