#pragma once

#include "sh_render_reduction_policy.h"
#include "sh_room_ui_reduction_policy.h"

namespace hp {

// Keep the effective Stationhead document-start script in one obvious place.
// The current runtime behavior is: autoplay/login handling, current interaction
// state, render reduction, then room UI reduction. Do not wrap whatever macro
// happened to be selected earlier; name the actual behavior explicitly.
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

// sh_webview.cpp still uses the historical call-site name. Keep exactly one
// adapter here until that large source is edited independently; all composition
// itself is the explicit BuildStationheadStartupScript() function above.
#undef StationheadAutoplayScript
#define StationheadAutoplayScript BuildStationheadStartupScript
