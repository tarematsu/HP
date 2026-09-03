namespace hp {

void SpotifyWebViews::SetPodcastMode(bool podcastMode) noexcept {
  if (!started_ || slots_.empty()) return;

  auto stopLegacyModeTimer = [this]() noexcept {
    HWND host = slots_[0].hostWindow;
    if (host && IsWindow(host)) KillTimer(host, kSpotifyModeTimer);
  };

  // The media panel owns the one-hour cadence. Keep Spotify's old timer off.
  stopLegacyModeTimer();
  if (podcastMode_ == podcastMode) return;

  ToggleMode();
  stopLegacyModeTimer();
}

}  // namespace hp
