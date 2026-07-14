#include "web_renderer.h"

namespace hp {
namespace {
constexpr int64_t kPlaybackRenderTransitionHoldMs = 500;

int64_t ProjectedElapsedMs(const NativePlaybackProjection& projection, int64_t nowMs) {
  if (!projection.playing) return projection.progressMs;
  if (projection.anchorAt > 0) return std::max<int64_t>(0, nowMs - projection.anchorAt);
  if (projection.sampledAt > 0) {
    return projection.progressMs + std::max<int64_t>(0, nowMs - projection.sampledAt);
  }
  return projection.progressMs;
}
}  // namespace

NativePlaybackRender Renderer::ResolveNativePlaybackLocked(size_t source, int64_t nowMs) const {
  NativePlaybackRender render;
  if (source >= nativePlaybackUpdates_.size()) return render;
  const NativePlaybackProjection& projection = nativePlaybackUpdates_[source].projection;
  if (!projection.available || projection.queue.empty()) return render;
  render.available = true;
  render.playing = projection.playing;
  if (projection.playing && projection.queueEndAt > 0 && nowMs >= projection.queueEndAt) {
    return render;
  }

  size_t index = projection.currentIndex > 0 &&
          projection.currentIndex < static_cast<int>(projection.queue.size())
      ? static_cast<size_t>(projection.currentIndex)
      : 0;
  int64_t elapsed = ProjectedElapsedMs(projection, nowMs);
  while (index < projection.queue.size()) {
    const int64_t duration = projection.queue[index].durationMs;
    if (!projection.playing || duration <= 0 ||
        elapsed < duration + kPlaybackRenderTransitionHoldMs) {
      break;
    }
    elapsed -= duration;
    ++index;
  }
  if (index >= projection.queue.size()) return render;

  render.track = projection.queue[index];
  render.hasTrack = !render.track.title.empty();
  render.progressMs = std::max<int64_t>(0, elapsed);
  if (render.track.durationMs > 0) {
    render.progressMs = std::min(render.progressMs, render.track.durationMs);
  }
  return render;
}

NativePlaybackRender Renderer::ResolveNativePlayback(size_t source, int64_t nowMs) const {
  std::lock_guard lock(nativePlaybackMutex_);
  return ResolveNativePlaybackLocked(source, nowMs);
}

bool Renderer::NativePlaybackActive(int64_t nowMs) const {
  std::lock_guard lock(nativePlaybackMutex_);
  for (size_t source = 0; source < nativePlaybackUpdates_.size(); ++source) {
    const NativePlaybackRender render = ResolveNativePlaybackLocked(source, nowMs);
    if (render.playing && render.hasTrack && render.track.durationMs > 0) return true;
  }
  return false;
}
}  // namespace hp
