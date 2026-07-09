#include "sh.h"

namespace hp {
void StationheadPlayer::SetBounds(const RECT& bounds) {
  if (EqualRect(&bounds_, &bounds)) return;
  bounds_ = bounds;
  controllerLayoutValid_ = false;
  if (startupPreviewActive_ || viewVisible_ || NeedsInteractiveWindow()) LayoutControllers();
  else KeepPlaybackBehindDashboard();
}

void StationheadPlayer::SelectTab(StationheadTabKind tab) {
  if (tab == StationheadTabKind::None && NeedsInteractiveWindow()) {
    tab = spotifyAuthorization_ ? StationheadTabKind::Auth : StationheadTabKind::Stationhead;
  }
  if (selectedTab_ == tab) {
    if (tab == StationheadTabKind::None && !viewVisible_) return;
    SetVisible(tab != StationheadTabKind::None);
    return;
  }
  selectedTab_ = tab;
  controllerLayoutValid_ = false;
  SetVisible(tab != StationheadTabKind::None);
}

bool StationheadPlayer::HasAuthTab() const {
  return authController_ != nullptr || !authPendingUrl_.empty();
}

HWND StationheadPlayer::ActiveHostWindowForAccountSetup() const noexcept {
  if (selectedTab_ == StationheadTabKind::Auth && authHostWindow_ && IsWindow(authHostWindow_)) return authHostWindow_;
  return hostWindow_;
}
}  // namespace hp
