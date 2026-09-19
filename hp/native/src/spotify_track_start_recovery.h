#pragma once

#include "common.h"

namespace hp {

// Normal Spotify startup has one destructive retry only: reload the current
// document once for this target generation. If that retry also fails, the
// caller skips the target. WebView rebuilds remain reserved for explicit
// process/DRM/media-pipeline failures outside this startup policy.
struct SpotifyTrackStartRecovery {
  ULONGLONG generation = 0;
  bool reloadIssued = false;
};

inline void BeginSpotifyTrackStartRecovery(
    SpotifyTrackStartRecovery& recovery, ULONGLONG generation,
    ULONGLONG) noexcept {
  recovery.generation = generation;
  recovery.reloadIssued = false;
}

inline bool ConsumeSpotifyStartupReload(
    SpotifyTrackStartRecovery& recovery, ULONGLONG generation,
    ULONGLONG now) noexcept {
  if (generation == 0) return false;
  if (recovery.generation != generation) {
    BeginSpotifyTrackStartRecovery(recovery, generation, now);
  }
  if (recovery.reloadIssued) return false;
  recovery.reloadIssued = true;
  return true;
}

}  // namespace hp
