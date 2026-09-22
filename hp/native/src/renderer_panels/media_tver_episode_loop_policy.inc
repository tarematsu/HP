// Unified TVer runtime. Like the YouTube control recovery script, one compact
// policy owns event wakeups, trusted-click targets and playback completion.
namespace {
constexpr wchar_t kNativeMediaTverControlRecoveryScript[] =
#include "media_tver_control_recovery.inc"
;
constexpr const wchar_t* kNativeMediaTverEpisodeLoopPolicyScript =
    kNativeMediaTverControlRecoveryScript;
}  // namespace
