#pragma once

// The July 26 build used the original page-owned Authorization capture and the
// direct streakStats request from sh_polling_policy.h. Later PCH layers wrapped
// both generators several times. Restore only these two generated scripts at the
// final auth-policy boundary; playback, login navigation, resource blocking, and
// periodic refresh policies remain unchanged.
#undef StationheadAuthCaptureScript
#undef StationheadApiPlayStatsScript

namespace hp {

inline std::wstring StationheadAuthCaptureScriptJuly26Baseline() {
  return StationheadAuthCaptureScript();
}

inline std::wstring StationheadApiPlayStatsScriptJuly26Baseline(int channelId) {
  return StationheadApiPlayStatsScript(channelId);
}

}  // namespace hp

#define StationheadAuthCaptureScript \
  StationheadAuthCaptureScriptJuly26Baseline
#define StationheadApiPlayStatsScript \
  StationheadApiPlayStatsScriptJuly26Baseline
