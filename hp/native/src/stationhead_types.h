#pragma once

#include "common.h"

namespace hp {

enum class StationheadTabKind {
  None,
  Stationhead,
  Auth,
};

enum StationheadChangeFlags : uint32_t {
  StationheadChangeNone = 0,
  StationheadChangeReturnMain = 1u << 0,
  StationheadChangeReleaseAuth = 1u << 1,
  StationheadChangeShowPlayer = 1u << 2,
};

struct StationheadStatus {
  // App handles advance this when the Stationhead notification or local
  // track-transition projection changes. Keeping it first lets the
  // default equality operator reject changed snapshots before touching URLs
  // and diagnostic strings.
  uint64_t contentRevision = 0;
  bool created = false;
  bool navigating = false;
  bool playing = false;
  bool loginRequired = false;
  bool spotifyAuthorization = false;
  bool visible = false;
  bool processFailed = false;
  bool spotifyConfigured = false;
  bool authAvailable = false;
  bool audioPlaying = false;
  bool audioMuted = false;
  std::wstring url;
  // Render-only routing metadata for choosing the shared playback feed.
  std::wstring fallbackUrl;
  std::wstring detail;

  bool operator==(const StationheadStatus&) const = default;
};

}  // namespace hp
