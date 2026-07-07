#include "web_renderer.h"

namespace hp {
int Renderer::ResolvePlaybackIndex(int64_t nowMs, int64_t* elapsedMs) const {
  if (elapsedMs) *elapsedMs = 0;
  if (!cloudPlayback_.available || cloudPlayback_.queue.empty()) return -1;

  int index = cloudPlayback_.currentIndex;
  if (index < 0 || index >= static_cast<int>(cloudPlayback_.queue.size())) return -1;
  if (cloudPlayback_.playing && cloudPlayback_.queueEndAt > 0 && nowMs >= cloudPlayback_.queueEndAt) return -1;

  int64_t elapsed = cloudPlayback_.progressMs;
  if (cloudPlayback_.playing) {
    if (cloudPlayback_.anchorAt > 0) elapsed = std::max<int64_t>(0, nowMs - cloudPlayback_.anchorAt);
    else if (cloudPlayback_.sampledAt > 0) elapsed += std::max<int64_t>(0, nowMs - cloudPlayback_.sampledAt);
  }

  while (index < static_cast<int>(cloudPlayback_.queue.size())) {
    const int64_t duration = cloudPlayback_.queue[index].durationMs;
    if (!cloudPlayback_.playing || duration <= 0 || elapsed < duration) break;
    elapsed -= duration;
    ++index;
  }
  if (index >= static_cast<int>(cloudPlayback_.queue.size())) return -1;
  if (elapsedMs) *elapsedMs = std::max<int64_t>(0, elapsed);
  return index;
}

bool Renderer::TickPlayback(int64_t nowMs) {
  const int next = ResolvePlaybackIndex(nowMs);
  if (next == lastResolvedPlaybackIndex_) return false;
  lastResolvedPlaybackIndex_ = next;
  return true;
}
}  // namespace hp
