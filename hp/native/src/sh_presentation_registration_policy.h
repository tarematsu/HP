#pragma once

#include "sh_render_reduction_policy.h"
#include "sh_room_ui_reduction_policy.h"

namespace hp {

// Final document-start presentation layer. This header is included only after
// the runtime/lifecycle/recovery/current-interaction autoplay wrappers have
// selected the actual StationheadAutoplayScript implementation. Keeping this
// as the last wrapper prevents later policy macros from silently dropping the
// lightweight CSS while preserving the playback state machine unchanged.
inline std::wstring StationheadAutoplayScriptPresentationReduced(
    const wchar_t* globalName,
    const wchar_t* messagePrefix) {
  std::wstring script = StationheadAutoplayScript(globalName, messagePrefix);
  script.push_back(L'\n');
  script.append(StationheadRenderReductionScript());
  script.push_back(L'\n');
  script.append(StationheadRoomUiReductionScript());
  return script;
}

}  // namespace hp

#undef StationheadAutoplayScript
#define StationheadAutoplayScript StationheadAutoplayScriptPresentationReduced
