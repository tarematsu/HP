#include "common.h"

namespace hp {
namespace {
constexpr UINT_PTR kPlaybackBoundaryTimer = 0x485042;

void CALLBACK PlaybackInvalidateProc(HWND window, UINT, UINT_PTR timerId, DWORD) {
  KillTimer(window, timerId);
  InvalidateRect(window, nullptr, FALSE);
}
}  // namespace

void SchedulePlaybackInvalidate(HWND window, int64_t delayMs) {
  KillTimer(window, kPlaybackBoundaryTimer);
  if (delayMs <= 0) return;
  const UINT delay = static_cast<UINT>(std::clamp<int64_t>(delayMs + 25, USER_TIMER_MINIMUM, 24LL * 60 * 60 * 1000));
  SetTimer(window, kPlaybackBoundaryTimer, delay, PlaybackInvalidateProc);
}
}  // namespace hp
