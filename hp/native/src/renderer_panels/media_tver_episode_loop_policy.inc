// Unified TVer runtime. Like the YouTube control recovery script, one compact
// policy owns event wakeups, trusted-click targets and playback completion.
namespace {
bool NativeMediaTverXPhaseActive() noexcept;

// Keep the redesigned-player reconciliation separate from the legacy recovery
// literal. MSVC limits the size of one concatenated string literal, while the
// WebView still needs both pieces to execute as one ordered policy.
constexpr wchar_t kNativeMediaTverCurrentPlayerSettingsScript[] =
#include "media_tver_current_player_settings.inc"
;

constexpr wchar_t kNativeMediaTverControlRecoveryScript[] =
#include "media_tver_control_recovery.inc"
;
}  // namespace
