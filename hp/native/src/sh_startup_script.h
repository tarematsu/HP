#pragma once

#include "sh_render_reduction_policy.h"
#include "sh_room_ui_reduction_policy.h"

namespace hp {

// This is the effective Stationhead document-start script.
// Install the CSS/event-only room policy first so it can claim the historical
// audio-only sentinel before legacy autoplay composition has a chance to attach
// its document-wide MutationObserver. Login/auth pages return from the room
// policy immediately apart from that observer suppression, then keep their full
// interaction surface through the current autoplay/auth policy.
inline std::wstring BuildStationheadStartupScript(
    const wchar_t* globalName,
    const wchar_t* messagePrefix) {
  std::wstring script = StationheadRoomUiReductionScript();
  script.push_back(L'\n');
  script.append(StationheadRenderReductionScript());
  script.push_back(L'\n');
  script.append(
      StationheadAutoplayScriptCurrentInteraction(globalName, messagePrefix));
  return script;
}

}  // namespace hp

// sh_webview.cpp still has the historical StationheadAutoplayScript call name.
// Keep one compatibility alias at that call boundary; startup composition above
// does not depend on any earlier macro-selected wrapper.
#undef StationheadAutoplayScript
#define StationheadAutoplayScript BuildStationheadStartupScript
