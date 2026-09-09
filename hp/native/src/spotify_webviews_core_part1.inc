  started_ = true;
  robustSchedulerStarted_ = false;
  staggerSlotIndex_ = 0;
  staggerSlotStartTick_ = 0;
  scheduleStartTick_ = 0;
  staggerSlotValidated_ = false;
  hostLayoutMask_ = ~0u;
  hostLayoutActiveSlot_ = kAccountCount;
  hostLayoutAuthenticationSlot_ = kAccountCount;
  alive_->store(true, std::memory_order_release);

  for (Slot& slot : slots_) {
    slot.state = SlotState::NotCreated;
    slot.unhealthySinceTick = 0;
    slot.targetGeneration = 0;
    slot.playerPage = false;
    slot.loginPage = false;
    slot.timedObserverReady = false;
    slot.timedObserverInstallInFlight = false;
    slot.controllerCreating = false;
    slot.controllerCreateTick = 0;
    slot.timedTarget = TimedSpotifyTarget::None;
    slot.timedCatalogIndex = kNoTimedCatalogIndex;
    slot.timedRotationCycle = 0;
    slot.timedRotationPosition = 0;
    slot.timedPlaybackStartTick = 0;
    slot.timedRandomFIndex = kNoTimedCatalogIndex;
    slot.timedMiddleOrder = {
        TimedSpotifyTarget::BitterBlue,
        TimedSpotifyTarget::Monshirocho,
        TimedSpotifyTarget::Munen,
        TimedSpotifyTarget::OnMyWay,
    };
    slot.timedRotationActive = false;
    slot.podcastBreakActive = false;
    if (!CreateHost(slot)) continue;
  }

  // Controller creation is serialized. Slot 0 starts immediately; the single
  // scheduler creates slots 1-4 when their 40-second turn arrives.
  if (!slots_.empty() && slots_[0].hostWindow) {
    CreateController(slots_[0]);
  }
  Resize();
  StartAutonomousSchedule(GetTickCount64());
}

void SpotifyWebViews::CreateController(Slot& slot) noexcept {
  if (!slot.hostWindow || !IsWindow(slot.hostWindow) ||
      slot.controller || slot.webview) {
    return;