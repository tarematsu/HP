#pragma once

#include "common.h"

namespace hp {

// Spotify changes URL for every track, so recovery is scoped to one target
// generation rather than to the lifetime of the WebView/session.
enum class SpotifyTrackStartRecoveryAction : unsigned char {
  None,
  ReloadDocument,
  RebuildSurface,
  SkipTrack,
};

struct SpotifyTrackStartRecovery {
  ULONGLONG generation = 0;
  ULONGLONG startedTick = 0;
  bool reloadIssued = false;
  bool rebuildIssued = false;
  bool skipIssued = false;
};

inline void BeginSpotifyTrackStartRecovery(
    SpotifyTrackStartRecovery& recovery, ULONGLONG generation,
    ULONGLONG now) noexcept {
  recovery.generation = generation;
  recovery.startedTick = now;
  recovery.reloadIssued = false;
  recovery.rebuildIssued = false;
  recovery.skipIssued = false;
}

inline SpotifyTrackStartRecoveryAction NextSpotifyTrackStartRecoveryAction(
    SpotifyTrackStartRecovery& recovery, ULONGLONG generation,
    bool requestRebuild, ULONGLONG now) noexcept {
  if (generation == 0) return SpotifyTrackStartRecoveryAction::None;
  if (recovery.generation != generation) {
    BeginSpotifyTrackStartRecovery(recovery, generation, now);
  }

  if (requestRebuild) {
    // Never jump directly to a destructive WebView rebuild. One document reload
    // must have been attempted first for this exact track generation.
    if (!recovery.reloadIssued) {
      return SpotifyTrackStartRecoveryAction::None;
    }
    if (!recovery.rebuildIssued) {
      recovery.rebuildIssued = true;
      return SpotifyTrackStartRecoveryAction::RebuildSurface;
    }
    if (!recovery.skipIssued) {
      recovery.skipIssued = true;
      return SpotifyTrackStartRecoveryAction::SkipTrack;
    }
    return SpotifyTrackStartRecoveryAction::None;
  }

  if (!recovery.reloadIssued) {
    recovery.reloadIssued = true;
    return SpotifyTrackStartRecoveryAction::ReloadDocument;
  }
  if (recovery.rebuildIssued && !recovery.skipIssued) {
    recovery.skipIssued = true;
    return SpotifyTrackStartRecoveryAction::SkipTrack;
  }
  return SpotifyTrackStartRecoveryAction::None;
}

}  // namespace hp
