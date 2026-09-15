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
  // Each fragment is an immediately-invoked function expression. A line break
  // before the next '(' is not an automatic-semicolon boundary in JavaScript;
  // without an explicit separator the next fragment is parsed as a call on the
  // previous fragment's return value and the render-reduction fragments never
  // execute.
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
