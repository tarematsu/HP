#include "web_renderer.h"

namespace hp {
void Renderer::Render(const RECT& dirty, const RenderState& state) {
  (void)state;
  if (!ready_) {
    statePublishedForPendingPaint_ = false;
    DrawStartupFallback(dirty);
    return;
  }
  if (statePublishedForPendingPaint_) {
    statePublishedForPendingPaint_ = false;
    FlushNativePlaybackMessages();
    return;
  }
  FlushNativePlaybackMessages();
}
}  // namespace hp
