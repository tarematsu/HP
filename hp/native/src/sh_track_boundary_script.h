#pragma once
#include "common.h"
#include "sh_playback_resource_policy_fix.h"
#include "sh_playback_visibility.h"

namespace hp {

// Login settlement now lives in the single compact startup runtime. Keep the
// first WebView2 document-script registration slot as a harmless no-op so the
// existing startup prerequisite/registration lifecycle does not need a second
// implementation path.
inline std::wstring StationheadLoginSettlementScript() {
  return L"void 0;";
}

// Page-side track-boundary polling is retired. Stationhead now keeps the room
// document stable and lets the one-minute native audio health path own ordinary
// silence detection and bounded recovery.
inline std::wstring StationheadTrackBoundaryScript(const wchar_t* messagePrefix) {
  (void)messagePrefix;
  return L"void 0;";
}

}  // namespace hp

// No page-side track-boundary messages are emitted by the compact runtime.
// Ignore a stale message from a document created by an older build rather than
// reintroducing a second refresh/rendering state machine.
#define HandleTrackEnded(now_ms, suppress_rendering) \
  do {                                                \
    (void)(now_ms);                                   \
    (void)(suppress_rendering);                       \
  } while (false)

#undef StationheadAuthCaptureScript
#define StationheadAuthCaptureScript StationheadLoginSettlementScript

#include "sh_july19_stats_policy_fix.h"
