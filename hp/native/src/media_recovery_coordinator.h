#pragma once

#include <algorithm>
#include <cstdint>

namespace hp {

// All playback surfaces use the same bounded escalation ladder. Detection
// remains surface-specific, but an incident has exactly one owner and one next
// action. This prevents DOM, native-audio, CDP and ProcessFailed signals from
// independently starting overlapping reload/rebuild loops.
enum class MediaRecoveryAction : uint8_t {
  None = 0,
  ReassertPlayback = 1,
  ReloadDocument = 2,
  RebuildSurface = 3,
  UseFallback = 4,
  RepairPlaybackState = 5,
  DeepRepairPlaybackState = 6,
  RecycleEnvironment = 7,
};

enum class MediaRecoveryEvidence : uint8_t {
  ConfirmedSilence = 0,
  TimelineStall = 1,
  NetworkFailure = 2,
  KeyWaitExpired = 3,
  FatalPipeline = 4,
  ProcessFailure = 5,
};

inline constexpr uint64_t kMediaRecoveryIncidentWindowMs =
    3ULL * 60ULL * 1000ULL;
inline constexpr uint64_t kMediaRecoveryActionCooldownMs = 10ULL * 1000ULL;
inline constexpr uint64_t kMediaRecoveryHealthyResetMs = 30ULL * 1000ULL;

struct MediaRecoveryEpisode {
  uint64_t generation = 0;
  uint64_t incidentStartedTick = 0;
  uint64_t lastEvidenceTick = 0;
  uint64_t lastActionTick = 0;
  uint64_t healthySinceTick = 0;
  MediaRecoveryAction highestAction = MediaRecoveryAction::None;
  uint8_t highestActionAttempts = 0;
};

inline constexpr void ResetMediaRecoveryEpisode(
    MediaRecoveryEpisode& episode, uint64_t generation = 0) noexcept {
  episode = {};
  episode.generation = generation;
}

inline constexpr void ObserveMediaRecoveryHealthy(
    MediaRecoveryEpisode& episode, uint64_t now,
    uint64_t generation) noexcept {
  if (episode.generation != generation) {
    ResetMediaRecoveryEpisode(episode, generation);
    return;
  }
  if (episode.highestAction == MediaRecoveryAction::None) return;
  if (episode.healthySinceTick == 0 || now < episode.healthySinceTick) {
    episode.healthySinceTick = now;
    return;
  }
  if (now - episode.healthySinceTick >= kMediaRecoveryHealthyResetMs) {
    ResetMediaRecoveryEpisode(episode, generation);
  }
}

inline constexpr MediaRecoveryAction NextMediaRecoveryAction(
    MediaRecoveryEpisode& episode, MediaRecoveryEvidence evidence,
    uint64_t now, uint64_t generation, bool destructiveAllowed,
    bool fallbackAvailable, bool extendedRecoveryAvailable = false) noexcept {
  if (episode.generation != generation || episode.incidentStartedTick == 0 ||
      now < episode.incidentStartedTick ||
      now - episode.incidentStartedTick > kMediaRecoveryIncidentWindowMs) {
    ResetMediaRecoveryEpisode(episode, generation);
    episode.incidentStartedTick = now == 0 ? 1 : now;
  }
  episode.lastEvidenceTick = now;
  episode.healthySinceTick = 0;

  if (!destructiveAllowed) return MediaRecoveryAction::None;
  MediaRecoveryAction requested = MediaRecoveryAction::None;
  switch (evidence) {
    case MediaRecoveryEvidence::FatalPipeline:
    case MediaRecoveryEvidence::ProcessFailure:
      requested = MediaRecoveryAction::RebuildSurface;
      break;
    case MediaRecoveryEvidence::NetworkFailure:
    case MediaRecoveryEvidence::KeyWaitExpired:
      requested = MediaRecoveryAction::ReloadDocument;
      break;
    case MediaRecoveryEvidence::ConfirmedSilence:
      // ConfirmedSilence is emitted after the surface-specific lightweight
      // Play/media-clock repair has failed, so it starts at document reload.
      if (episode.highestAction == MediaRecoveryAction::None ||
          episode.highestAction == MediaRecoveryAction::ReassertPlayback) {
        requested = MediaRecoveryAction::ReloadDocument;
      } else if (episode.highestAction == MediaRecoveryAction::ReloadDocument) {
        requested = MediaRecoveryAction::RebuildSurface;
      } else if (episode.highestAction == MediaRecoveryAction::RebuildSurface) {
        if (extendedRecoveryAvailable) {
          requested = episode.highestActionAttempts < 2
              ? MediaRecoveryAction::RebuildSurface
              : MediaRecoveryAction::RepairPlaybackState;
        } else {
          requested = fallbackAvailable ? MediaRecoveryAction::UseFallback
                                        : MediaRecoveryAction::None;
        }
      } else if (episode.highestAction ==
                 MediaRecoveryAction::RepairPlaybackState) {
        requested = extendedRecoveryAvailable
            ? MediaRecoveryAction::DeepRepairPlaybackState
            : MediaRecoveryAction::None;
      } else if (episode.highestAction ==
                 MediaRecoveryAction::DeepRepairPlaybackState) {
        requested = extendedRecoveryAvailable
            ? MediaRecoveryAction::RecycleEnvironment
            : MediaRecoveryAction::None;
      }
      break;
    case MediaRecoveryEvidence::TimelineStall:
      if (episode.highestAction == MediaRecoveryAction::None) {
        requested = MediaRecoveryAction::ReassertPlayback;
      } else if (episode.highestAction ==
                 MediaRecoveryAction::ReassertPlayback) {
        requested = MediaRecoveryAction::ReloadDocument;
      } else if (episode.highestAction ==
                 MediaRecoveryAction::ReloadDocument) {
        requested = MediaRecoveryAction::RebuildSurface;
      } else if (episode.highestAction ==
                 MediaRecoveryAction::RebuildSurface) {
        if (extendedRecoveryAvailable && episode.highestActionAttempts >= 2) {
          requested = MediaRecoveryAction::RepairPlaybackState;
        } else {
          requested = MediaRecoveryAction::RebuildSurface;
        }
      } else if (episode.highestAction ==
                 MediaRecoveryAction::RepairPlaybackState) {
        requested = extendedRecoveryAvailable
            ? MediaRecoveryAction::DeepRepairPlaybackState
            : MediaRecoveryAction::None;
      } else if (episode.highestAction ==
                 MediaRecoveryAction::DeepRepairPlaybackState) {
        requested = extendedRecoveryAvailable
            ? MediaRecoveryAction::RecycleEnvironment
            : MediaRecoveryAction::None;
      }
      break;
  }

  const bool definitiveFailure =
      evidence == MediaRecoveryEvidence::FatalPipeline ||
      evidence == MediaRecoveryEvidence::ProcessFailure;
  if (episode.lastActionTick != 0 && now >= episode.lastActionTick &&
      now - episode.lastActionTick < kMediaRecoveryActionCooldownMs &&
      (!definitiveFailure ||
       static_cast<uint8_t>(requested) <=
           static_cast<uint8_t>(episode.highestAction))) {
    return MediaRecoveryAction::None;
  }

  // Never move backwards when a weaker late signal belongs to the same
  // incident. The same action can run one additional time for a replacement
  // surface that also fails, but it cannot create an unbounded loop.
  if (static_cast<uint8_t>(requested) <
      static_cast<uint8_t>(episode.highestAction)) {
    return MediaRecoveryAction::None;
  }
  if (requested == episode.highestAction) {
    if (episode.highestActionAttempts >= 2) {
      return MediaRecoveryAction::None;
    }
    ++episode.highestActionAttempts;
    episode.lastActionTick = now == 0 ? 1 : now;
    return requested;
  }
  episode.highestAction = requested;
  episode.highestActionAttempts = 1;
  episode.lastActionTick = now == 0 ? 1 : now;
  return requested;
}

static_assert(kMediaRecoveryActionCooldownMs < kMediaRecoveryHealthyResetMs);
static_assert(kMediaRecoveryHealthyResetMs < kMediaRecoveryIncidentWindowMs);

inline constexpr bool MediaRecoveryCoordinatorContract() noexcept {
  MediaRecoveryEpisode episode;
  if (NextMediaRecoveryAction(
          episode, MediaRecoveryEvidence::ConfirmedSilence, 100'000, 7,
          true, true) != MediaRecoveryAction::ReloadDocument) {
    return false;
  }
  if (NextMediaRecoveryAction(
          episode, MediaRecoveryEvidence::ConfirmedSilence, 105'000, 7,
          true, true) != MediaRecoveryAction::None) {
    return false;
  }
  if (NextMediaRecoveryAction(
          episode, MediaRecoveryEvidence::ConfirmedSilence, 111'000, 7,
          true, true) != MediaRecoveryAction::RebuildSurface) {
    return false;
  }
  if (NextMediaRecoveryAction(
          episode, MediaRecoveryEvidence::ProcessFailure, 112'000, 7,
          true, true) != MediaRecoveryAction::None) {
    return false;
  }
  if (NextMediaRecoveryAction(
          episode, MediaRecoveryEvidence::ConfirmedSilence, 123'000, 7,
          true, true) != MediaRecoveryAction::UseFallback) {
    return false;
  }
  ObserveMediaRecoveryHealthy(episode, 130'000, 7);
  ObserveMediaRecoveryHealthy(
      episode, 130'000 + kMediaRecoveryHealthyResetMs, 7);
  return episode.highestAction == MediaRecoveryAction::None;
}

static_assert(MediaRecoveryCoordinatorContract());

inline constexpr bool MediaRecoveryWithoutFallbackContract() noexcept {
  MediaRecoveryEpisode episode;
  if (NextMediaRecoveryAction(
          episode, MediaRecoveryEvidence::ConfirmedSilence, 100'000, 9,
          true, false) != MediaRecoveryAction::ReloadDocument) {
    return false;
  }
  if (NextMediaRecoveryAction(
          episode, MediaRecoveryEvidence::ConfirmedSilence, 111'000, 9,
          true, false) != MediaRecoveryAction::RebuildSurface) {
    return false;
  }
  if (NextMediaRecoveryAction(
          episode, MediaRecoveryEvidence::ConfirmedSilence, 122'000, 9,
          true, false) != MediaRecoveryAction::None) {
    return false;
  }
  // A later definitive crash may still rebuild the replacement once.
  return NextMediaRecoveryAction(
             episode, MediaRecoveryEvidence::ProcessFailure, 123'000, 9,
             true, false) == MediaRecoveryAction::RebuildSurface;
}

static_assert(MediaRecoveryWithoutFallbackContract());

inline constexpr bool MediaRecoveryTimelineStallContract() noexcept {
  MediaRecoveryEpisode episode;
  if (NextMediaRecoveryAction(
          episode, MediaRecoveryEvidence::TimelineStall, 100'000, 11,
          true, false) != MediaRecoveryAction::ReassertPlayback) {
    return false;
  }
  if (NextMediaRecoveryAction(
          episode, MediaRecoveryEvidence::TimelineStall, 111'000, 11,
          true, false) != MediaRecoveryAction::ReloadDocument) {
    return false;
  }
  return NextMediaRecoveryAction(
             episode, MediaRecoveryEvidence::TimelineStall, 122'000, 11,
             true, false) == MediaRecoveryAction::RebuildSurface;
}

static_assert(MediaRecoveryTimelineStallContract());

inline constexpr bool MediaRecoveryExtendedRecoveryContract() noexcept {
  MediaRecoveryEpisode episode;
  if (NextMediaRecoveryAction(
          episode, MediaRecoveryEvidence::TimelineStall, 100'000, 13,
          true, false, true) != MediaRecoveryAction::ReassertPlayback) {
    return false;
  }
  if (NextMediaRecoveryAction(
          episode, MediaRecoveryEvidence::TimelineStall, 111'000, 13,
          true, false, true) != MediaRecoveryAction::ReloadDocument) {
    return false;
  }
  if (NextMediaRecoveryAction(
          episode, MediaRecoveryEvidence::TimelineStall, 122'000, 13,
          true, false, true) != MediaRecoveryAction::RebuildSurface) {
    return false;
  }
  if (NextMediaRecoveryAction(
          episode, MediaRecoveryEvidence::TimelineStall, 133'000, 13,
          true, false, true) != MediaRecoveryAction::RebuildSurface) {
    return false;
  }
  if (NextMediaRecoveryAction(
          episode, MediaRecoveryEvidence::TimelineStall, 144'000, 13,
          true, false, true) != MediaRecoveryAction::RepairPlaybackState) {
    return false;
  }
  if (NextMediaRecoveryAction(
          episode, MediaRecoveryEvidence::TimelineStall, 155'000, 13,
          true, false, true) != MediaRecoveryAction::DeepRepairPlaybackState) {
    return false;
  }
  if (NextMediaRecoveryAction(
          episode, MediaRecoveryEvidence::TimelineStall, 166'000, 13,
          true, false, true) != MediaRecoveryAction::RecycleEnvironment) {
    return false;
  }
  return NextMediaRecoveryAction(
             episode, MediaRecoveryEvidence::TimelineStall, 177'000, 13,
             true, false, true) == MediaRecoveryAction::None;
}

static_assert(MediaRecoveryExtendedRecoveryContract());

}  // namespace hp
