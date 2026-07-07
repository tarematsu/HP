#include "renderer_visuals.h"

namespace hp::visual {
namespace {
std::atomic<bool> gAnimationLoopRunning{false};
std::atomic<HWND> gAnimationWindow{nullptr};

void StartAnimationLoop() {
  bool expected = false;
  if (!gAnimationLoopRunning.compare_exchange_strong(expected, true)) return;
  std::thread([] {
    while (TransitionActive()) {
      HWND window = gAnimationWindow.load(std::memory_order_acquire);
      if (window && IsWindow(window)) InvalidateRect(window, nullptr, FALSE);
      Sleep(33);
    }
    HWND window = gAnimationWindow.load(std::memory_order_acquire);
    if (window && IsWindow(window)) InvalidateRect(window, nullptr, FALSE);
    gAnimationLoopRunning.store(false);
    if (TransitionActive()) StartAnimationLoop();
  }).detach();
}
}  // namespace

void BeginWindowTransition(HWND window) {
  gAnimationWindow.store(window, std::memory_order_release);
  BeginTransition();
  StartAnimationLoop();
}
}  // namespace hp::visual
