namespace hp {
namespace {

constexpr double kSpotifySerializedRecoveryZoom = 0.80;

}  // namespace

void SpotifyWebViews::RefreshSpotifyHostLayout() noexcept {
  if (slots_.empty()) return;

  const size_t activeIndex = staggerSlotIndex_ % slots_.size();
  unsigned mask = 0;
  for (size_t i = 0; i < slots_.size(); ++i) {
    if (!slots_[i].playing) mask |= (1u << i);
  }
  const bool authenticationVisible =
      activeIndex < slots_.size() && SlotIsLoginPage(slots_[activeIndex]);

  if (activeIndex < slots_.size() && slots_[activeIndex].controller) {
    double zoom = 1.0;
    if (FAILED(slots_[activeIndex].controller->get_ZoomFactor(&zoom)) ||
        zoom < 0.799 || zoom > 0.801) {
      slots_[activeIndex].controller->put_ZoomFactor(kSpotifySerializedRecoveryZoom);
    }
  }

  if (hostLayoutMask_ == mask && hostLayoutActiveSlot_ == activeIndex &&
      hostLayoutAuthenticationVisible_ == authenticationVisible) {
    return;
  }
  hostLayoutMask_ = mask;
  hostLayoutActiveSlot_ = activeIndex;
  hostLayoutAuthenticationVisible_ = authenticationVisible;
  PlaceHosts();
}

}  // namespace hp
