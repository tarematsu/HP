#include "sh.h"

namespace hp {
bool StationheadPlayer::NeedsInteractiveWindow() const {
  return selectedTab_ == StationheadTabKind::Auth || spotifyAuthorization_ || loginSessionActive_;
}
}  // namespace hp
