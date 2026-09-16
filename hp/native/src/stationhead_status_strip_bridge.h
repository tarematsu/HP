#pragma once

// Namespace-neutral because native media composition includes this header from
// inside namespace hp. The dashboard playback worker publishes the same queue
// projection used by native playback; the status strip resolves only the track
// that should be playing now, never an upcoming/planned queue entry.
struct StationheadStatusStripTrackPoint {
  std::wstring title;
  int64_t durationMs = 0;
};

struct StationheadStatusStripPlaybackState {
  bool available = false;
  bool playing = false;
  bool stale = false;
  bool ended = false;
  bool setupRequired = false;
  int currentIndex = -1;
  int64_t progressMs = 0;
  int64_t anchorAt = 0;
  int64_t sampledAt = 0;
  int64_t queueEndAt = 0;
  std::vector<StationheadStatusStripTrackPoint> queue;
};

inline std::mutex stationheadStatusStripPlaybackMutex;
inline StationheadStatusStripPlaybackState stationheadStatusStripPlayback;

template <typename Projection>
inline void PublishStationheadStatusStripPlayback(
    const Projection& projection) {
  StationheadStatusStripPlaybackState next;
  next.available = projection.available;
  next.playing = projection.playing;
  next.stale = projection.stale;
  next.ended = projection.ended;
  next.setupRequired = projection.setupRequired;
  next.currentIndex = projection.currentIndex;
  next.progressMs = projection.progressMs;
  next.anchorAt = projection.anchorAt;
  next.sampledAt = projection.sampledAt;
  next.queueEndAt = projection.queueEndAt;
  next.queue.reserve(projection.queue.size());
  for (const auto& track : projection.queue) {
    next.queue.push_back({track.title, track.durationMs});
  }
  std::lock_guard lock(stationheadStatusStripPlaybackMutex);
  stationheadStatusStripPlayback = std::move(next);
}

inline std::wstring StationheadStatusStripCurrentTrackTitle(int64_t nowMs) {
  std::lock_guard lock(stationheadStatusStripPlaybackMutex);
  const auto& state = stationheadStatusStripPlayback;
  if (!state.available || !state.playing || state.stale || state.ended ||
      state.setupRequired || state.currentIndex < 0 ||
      state.currentIndex >= static_cast<int>(state.queue.size())) {
    return {};
  }
  if (state.queueEndAt > 0 && nowMs >= state.queueEndAt) return {};

  int64_t elapsed = state.progressMs;
  if (state.anchorAt > 0) {
    elapsed = std::max<int64_t>(0, nowMs - state.anchorAt);
  } else if (state.sampledAt > 0) {
    elapsed += std::max<int64_t>(0, nowMs - state.sampledAt);
  }

  size_t index = static_cast<size_t>(state.currentIndex);
  constexpr int64_t kTrackTransitionHoldMs = 500;
  while (index < state.queue.size()) {
    const int64_t duration = state.queue[index].durationMs;
    if (duration <= 0 || elapsed < duration + kTrackTransitionHoldMs) break;
    elapsed -= duration;
    ++index;
  }
  if (index >= state.queue.size()) return {};
  return state.queue[index].title;
}
