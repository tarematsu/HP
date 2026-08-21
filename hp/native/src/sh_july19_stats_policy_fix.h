#pragma once

namespace hp {

// The last sustained stable play-count period ended when PR #368 changed
// Authorization reuse semantics. Restore the pre-#368 acquisition generators
// that are still present in the codebase instead of layering another collector.
//
// The original sh_shared.h capture promotes the newest page-owned Authorization
// at request dispatch time. Keep the current login-settlement probe by appending
// it after that stable capture script in the same document-start registration.
inline std::wstring StationheadPre368AuthAndLoginSettlementScript() {
  std::wstring script = StationheadAuthCaptureScript();
  script.push_back(L'\n');
  script.append(StationheadLoginSettlementScript());
  return script;
}

// b2e3101f (2026-07-26 JST) used this runtime-fixed request generator. It keeps
// the successful ten-minute quiet period tied to the exact Authorization value,
// retries normally when no successful response exists, clears the token on 401,
// and leaves a 403 from the stats endpoint from destroying the playback session.
inline std::wstring StationheadPre368ApiPlayStatsScript(int channelId) {
  return StationheadApiPlayStatsScriptRuntimeFixed(channelId);
}

}  // namespace hp

// This header is included at the final Stationhead script-composition boundary.
// Select the stable pre-#368 data path after later authentication wrappers, while
// leaving current playback/resource/login behavior otherwise untouched.
#undef StationheadAuthCaptureScript
#define StationheadAuthCaptureScript StationheadPre368AuthAndLoginSettlementScript

#undef StationheadApiPlayStatsScript
#define StationheadApiPlayStatsScript StationheadPre368ApiPlayStatsScript
