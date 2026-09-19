#pragma once

#include "sh_compact_runtime_script.h"
#include "sh_onboarding_click_policy.h"
#include "sh_render_reduction_policy.h"
#include "sh_room_ui_reduction_policy.h"

namespace hp {

// Final Stationhead document-start composition. Runtime state, recovery,
// lifecycle and presentation policies each live in their own responsibility
// file; this function only defines their execution order. Keep explicit
// semicolons between IIFEs: a bare newline before the next '(' is not an ASI
// boundary and can turn the next policy into a call on the previous result.
inline std::wstring BuildStationheadStartupScript(
    const wchar_t* globalName,
    const wchar_t* messagePrefix) {
  std::wstring script =
      StationheadCompactRuntimeScript(globalName, messagePrefix);
  script.append(L";\n");
  script.append(StationheadRenderReductionScript());
  script.append(L";\n");
  script.append(StationheadRoomUiReductionScript());
  script.push_back(L';');
  return script;
}

}  // namespace hp

#undef StationheadAutoplayScript
#define StationheadAutoplayScript BuildStationheadStartupScript
