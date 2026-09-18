#include "service_monitor_grid.h"

namespace hp {
namespace {

constexpr double kSpotifySurfaceZoom = 0.50;

bool SpotifyHostPositionEqual(const RECT& left, const RECT& right) noexcept {
  return left.left == right.left && left.top == right.top;
}

bool SpotifyHostSizeEqual(const RECT& left, const RECT& right) noexcept {
  return left.right - left.left == right.right - right.left &&
         left.bottom - left.top == right.bottom - right.top;
}

void ApplySpotifyHostVisualClip(HWND window, bool fullSize) noexcept {
  if (!window || !IsWindow(window)) return;
  if (fullSize) {
    SetWindowRgn(window, nullptr, TRUE);
    return;
  }
  HRGN region = CreateRectRgn(0, 0, 1, 1);
  if (!region) return;
  if (!SetWindowRgn(window, region, TRUE)) DeleteObject(region);
}

}  // namespace

void SpotifyWebViews::SetMonitorForegroundSlot(int slotIndex) noexcept {
  if (slotIndex < 0 ||
      slotIndex >= static_cast<int>(kSpotifyActiveAccountCount)) {
    slotIndex = -1;
  }
  gSpotifyMonitorForegroundAccountIndex = slotIndex;
  const int runtimeLane = SpotifyRuntimeLaneForControlAccount(slotIndex);
  gSpotifyMonitorForegroundSlot = runtimeLane;
  if (monitorForegroundSlot_ == runtimeLane) return;
  monitorForegroundSlot_ = runtimeLane;
  for (Slot& slot : slots_) slot.hostLayoutApplied = false;
  PlaceHosts();
}

void SpotifyWebViews::PlaceHosts() noexcept {
  if (!parentWindow_ || !IsWindow(parentWindow_) || slots_.empty()) return;

  const int selectedRuntimeLane = SpotifyRuntimeLaneForControlAccount(
      gSpotifyMonitorForegroundAccountIndex);
  if (monitorForegroundSlot_ != selectedRuntimeLane) {
    monitorForegroundSlot_ = selectedRuntimeLane;
    gSpotifyMonitorForegroundSlot = selectedRuntimeLane;
    for (Slot& slot : slots_) slot.hostLayoutApplied = false;
  }

  RECT client{};
  if (!GetClientRect(parentWindow_, &client)) return;

  for (size_t i = 0; i < slots_.size(); ++i) {
    Slot& slot = slots_[i];
    if (!slot.hostWindow || !IsWindow(slot.hostWindow)) continue;

    const bool loginPage = SlotIsLoginPage(slot);
    const bool authentication =
        i == hostLayoutAuthenticationSlot_ && SlotIsLoginPage(slot);
    const bool monitorForeground =
        SpotifyRuntimeLaneForAccount(i) == monitorForegroundSlot_;
    const bool gridForeground = gSpotifyMonitorGridVisible && !loginPage;
    const bool authenticationForeground =
        authentication && monitorForegroundSlot_ < 0;

    // Normal playback hosts are permanently parked in S1-S5 grid tiles from
    // startup. Login pages retain the historical full-client authentication
    // surface. Background playback stays visually clipped to 1x1 until the
    // unified Monitor S mode raises the complete six-window service grid.
    const int hostX = client.left;
    const int hostY = client.top;
    const int width = std::max(1L, client.right - client.left);
    const int height = std::max(1L, client.bottom - client.top);
    const RECT fullClient{hostX, hostY, hostX + width, hostY + height};
    const RECT serviceTile = ServiceMonitorTileBounds(client, i + 1);
    const RECT desired = loginPage ? fullClient : serviceTile;
    const HWND insertAfter =
        gridForeground || monitorForeground || authenticationForeground
            ? HWND_TOP
            : HWND_BOTTOM;

    const bool positionChanged =
        !slot.hostLayoutApplied ||
        !SpotifyHostPositionEqual(slot.hostLayoutRect, desired);
    const bool sizeChanged =
        !slot.hostLayoutApplied ||
        !SpotifyHostSizeEqual(slot.hostLayoutRect, desired);
    const bool zOrderChanged =
        !slot.hostLayoutApplied || slot.hostLayoutInsertAfter != insertAfter;
    const bool placementChanged = positionChanged || sizeChanged || zOrderChanged;
    const bool controllerChanged =
        slot.hostLayoutController != slot.controller.Get();

    // Apply the visual region before exposing the child HWND. Spotify host
    // windows use a black class brush, so showing a background host even
    // briefly can produce a DWM black flash before the 1x1 clip lands.
    ApplySpotifyHostVisualClip(
        slot.hostWindow,
        authentication || monitorForeground || gridForeground);

    if (placementChanged) {
      UINT flags = SWP_NOACTIVATE | SWP_SHOWWINDOW;
      if (!positionChanged) flags |= SWP_NOMOVE;
      if (!sizeChanged) flags |= SWP_NOSIZE;
      if (!zOrderChanged) flags |= SWP_NOZORDER;
      if (SetWindowPos(slot.hostWindow, insertAfter,
                       desired.left, desired.top,
                       std::max<LONG>(1, desired.right - desired.left),
                       std::max<LONG>(1, desired.bottom - desired.top), flags)) {
        slot.hostLayoutRect = desired;
        slot.hostLayoutInsertAfter = insertAfter;
        slot.hostLayoutApplied = true;
      }
    }

    if (!slot.controller) {
      slot.hostLayoutController = nullptr;
      continue;
    }

    slot.controller->put_Bounds(
        SpotifyControllerBounds(slot.hostWindow, loginPage));

    if (controllerChanged) {
      slot.hostLayoutController = slot.controller.Get();
      slot.controller->put_IsVisible(TRUE);
      slot.controller->put_ZoomFactor(kSpotifySurfaceZoom);
    }

    if (positionChanged || controllerChanged) {
      slot.controller->NotifyParentWindowPositionChanged();
    }
  }
}

void SpotifyWebViews::RefreshSpotifyHostLayout() noexcept {
  if (slots_.empty()) return;

  const size_t activeIndex = schedulerCursor_ % slots_.size();
  const size_t recoveryIndex =
      activeIndex < slots_.size() &&
      SlotStateNeedsRecovery(slots_[activeIndex].state) &&
      !SlotIsLoginPage(slots_[activeIndex])
          ? activeIndex
          : slots_.size();
  unsigned mask = 0;
  size_t foregroundAuthenticationIndex = slots_.size();
  for (size_t i = 0; i < slots_.size(); ++i) {
    if (!SlotStateIsHealthy(slots_[i].state)) mask |= (1u << i);
    if (foregroundAuthenticationIndex == slots_.size() && slots_[i].webview &&
        SlotIsLoginPage(slots_[i])) {
      foregroundAuthenticationIndex = i;
    }
  }

  const auto maintainAuthenticationForeground =
      [this, foregroundAuthenticationIndex](bool layoutChanged) noexcept {
        if (monitorForegroundSlot_ >= 0 ||
            foregroundAuthenticationIndex >= slots_.size() ||
            !parentWindow_ || !IsWindow(parentWindow_)) {
          return;
        }
        Slot& slot = slots_[foregroundAuthenticationIndex];
        if (!slot.hostWindow || !IsWindow(slot.hostWindow) || !slot.webview ||
            !SlotIsLoginPage(slot)) {
          return;
        }

        if (!layoutChanged && GetWindow(slot.hostWindow, GW_HWNDPREV) != nullptr) {
          SetWindowPos(slot.hostWindow, HWND_TOP, 0, 0, 0, 0,
                       SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE |
                           SWP_SHOWWINDOW);
        }
      };

  if (hostLayoutMask_ == mask && hostLayoutActiveSlot_ == recoveryIndex &&
      hostLayoutAuthenticationSlot_ == foregroundAuthenticationIndex) {
    maintainAuthenticationForeground(false);
    return;
  }
  hostLayoutMask_ = mask;
  hostLayoutActiveSlot_ = recoveryIndex;
  hostLayoutAuthenticationSlot_ = foregroundAuthenticationIndex;
  PlaceHosts();
  maintainAuthenticationForeground(true);
}

}  // namespace hp
