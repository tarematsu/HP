#include "web_renderer.h"

namespace hp {
void Renderer::Render(const RECT& dirty, const RenderState& state) {
  (void)state;
  if (!ready_) {
    statePublishedForPendingPaint_ = false;
    DrawStartupFallback(dirty);
    return;
  }
  statePublishedForPendingPaint_ = false;
}

void Renderer::NotifyRadarUpdated() {
  if (!radarComposeStarted_.load(std::memory_order_acquire)) return;
  {
    std::lock_guard lock(radarComposeWakeMutex_);
    radarComposePending_ = true;
  }
  radarComposeWake_.notify_all();
}
}  // namespace hp
