namespace hp {
namespace {

constexpr LONG kSpotifyInternalViewportWidth = 320;
constexpr LONG kSpotifyInternalViewportHeight = 160;

RECT SpotifyFixedViewportBounds() noexcept {
  return RECT{0, 0, kSpotifyInternalViewportWidth,
              kSpotifyInternalViewportHeight};
}

RECT SpotifyControllerBounds(HWND hostWindow, bool authentication) noexcept {
  if (authentication && hostWindow && IsWindow(hostWindow)) {
    RECT client{};
    if (GetClientRect(hostWindow, &client) &&
        client.right > client.left && client.bottom > client.top) {
      return client;
    }
  }
  return SpotifyFixedViewportBounds();
}

}  // namespace
}  // namespace hp
