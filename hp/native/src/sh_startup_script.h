#pragma once

#include "sh_render_reduction_policy.h"
#include "sh_room_ui_reduction_policy.h"

namespace hp {

// This is the effective Stationhead document-start script.
// Keep the real execution order visible here instead of stacking policy wrappers.
inline std::wstring BuildStationheadStartupScript(
    const wchar_t* globalName,
    const wchar_t* messagePrefix) {
  std::wstring script =
      StationheadAutoplayScriptCurrentInteraction(globalName, messagePrefix);
  script.push_back(L'\n');
  script.append(StationheadRenderReductionScript());
  script.push_back(L'\n');
  script.append(StationheadRoomUiReductionScript());
  return script;
}

}  // namespace hp

// sh_webview.cpp still has the historical StationheadAutoplayScript call name.
// Keep one compatibility alias at that call boundary; startup composition above
// does not depend on any earlier macro-selected wrapper.
#undef StationheadAutoplayScript
#define StationheadAutoplayScript BuildStationheadStartupScript
