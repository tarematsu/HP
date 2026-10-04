// Unified TVer runtime. Like the YouTube control recovery script, one compact
// policy owns event wakeups, trusted-click targets and playback completion.
namespace {
bool NativeMediaTverXPhaseActive() noexcept;

constexpr wchar_t kNativeMediaTverControlRecoveryScript[] =
#include "media_tver_current_player_settings.inc"
L";"
#include "media_tver_control_recovery.inc"
;
}  // namespace
