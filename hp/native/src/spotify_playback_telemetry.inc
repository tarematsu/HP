#include "spotify_playback_telemetry.h"

namespace hp {
namespace {

SpotifyWebViews* gSpotifyPlaybackTelemetrySource = nullptr;

void SetSpotifyPlaybackTelemetrySource(SpotifyWebViews* source) noexcept {
  gSpotifyPlaybackTelemetrySource = source;
}

}  // namespace

std::string CurrentSpotifyPlaybackTelemetryJson() noexcept {
  if (!gSpotifyPlaybackTelemetrySource) {
    return "{\"available\":false,\"sampledAt\":0,\"playingCount\":0,\"slots\":[]}";
  }
  return gSpotifyPlaybackTelemetrySource->PlaybackTelemetryJson();
}

std::string SpotifyWebViews::PlaybackTelemetryJson() const noexcept {
  try {
    size_t playingCount = 0;
    for (const Slot& slot : slots_) {
      if (slot.state == SlotState::Playing && CurrentMusicTrack(slot)) {
        ++playingCount;
      }
    }

    std::ostringstream out;
    out << "{\"available\":" << (started_ && !networkBlocked_ ? "true" : "false")
        << ",\"sampledAt\":" << UnixMillis()
        << ",\"playingCount\":" << playingCount
        << ",\"slots\":[";

    for (size_t i = 0; i < slots_.size(); ++i) {
      if (i) out << ',';
      const Slot& slot = slots_[i];
      const ManagedTrack* const track = CurrentMusicTrack(slot);
      const bool playing = slot.state == SlotState::Playing && track;
      const char* state = "not-created";
      switch (slot.state) {
        case SlotState::NotCreated: state = "not-created"; break;
        case SlotState::Authenticating: state = "authenticating"; break;
        case SlotState::Navigating: state = "navigating"; break;
        case SlotState::WaitingTarget: state = "waiting-target"; break;
        case SlotState::Playing: state = "playing"; break;
        case SlotState::Recovering: state = "recovering"; break;
      }

      out << "{\"index\":" << (slot.index + 1)
          << ",\"state\":\"" << state << "\""
          << ",\"playing\":" << (playing ? "true" : "false")
          << ",\"generation\":" << slot.targetGeneration
          << ",\"startedAt\":" << slot.lastPlaybackStartedAt
          << ",\"title\":";
      out << WideToUtf8(JsonQuote(track ? track->title : L""));
      out << ",\"path\":";
      out << WideToUtf8(JsonQuote(track ? track->path : L""));
      out << '}';
    }
    out << "]}";
    return out.str();
  } catch (...) {
    return "{\"available\":false,\"sampledAt\":0,\"playingCount\":0,\"slots\":[]}";
  }
}

void SpotifyWebViews::MaybePostPlaybackTelemetryChanged(ULONGLONG now) noexcept {
  if (!playbackTelemetryDirty_ || !parentWindow_ || !IsWindow(parentWindow_)) return;
  if (now == 0) now = GetTickCount64();
  if (lastPlaybackTelemetryPostTick_ != 0 &&
      now - lastPlaybackTelemetryPostTick_ < kSpotifyPlaybackTelemetryMinIntervalMs) {
    return;
  }
  if (!PostMessageW(parentWindow_, kSpotifyPlaybackTelemetryChangedMessage, 0, 0)) return;
  playbackTelemetryDirty_ = false;
  lastPlaybackTelemetryPostTick_ = now;
}

void SpotifyWebViews::NotifyPlaybackTelemetryChanged() noexcept {
  playbackTelemetryDirty_ = true;
  MaybePostPlaybackTelemetryChanged(GetTickCount64());
  if (playbackTelemetryDirty_) ArmRobustScheduler();
}

}  // namespace hp
