#pragma once

#include "sh_compact_runtime_script.h"
#include "sh_render_reduction_policy.h"
#include "sh_room_ui_reduction_policy.h"

namespace hp {

// Final Stationhead document-start composition. Runtime state, recovery,
// lifecycle and presentation policies each live in their own responsibility
// file; this function only defines their execution order.
inline std::wstring BuildStationheadStartupScript(
    const wchar_t* globalName,
    const wchar_t* messagePrefix) {
  std::wstring script =
      StationheadCompactRuntimeScript(globalName, messagePrefix);
  script.push_back(L'\n');
  script.append(StationheadRenderReductionScript());
  script.push_back(L'\n');
  script.append(StationheadRoomUiReductionScript());
  return script;
}

}  // namespace hp

#undef StationheadAutoplayScript
#define StationheadAutoplayScript BuildStationheadStartupScript
