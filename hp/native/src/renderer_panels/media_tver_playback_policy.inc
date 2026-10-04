// The TVer watchdog is the sole owner of the unified runtime.
// Action coordinates are returned to the native trusted-click dispatcher just
// like the YouTube control recovery path.
namespace {
const wchar_t* NativeMediaTverPlaybackWatchdogPolicyScript() noexcept {
  try {
    // Keep the two sizeable source literals separate for MSVC, then join them
    // once at runtime. The semicolon preserves strict execution order: current
    // TVer UI reconciliation runs first and can suppress obsolete recovery
    // actions before the legacy playback/queue policy evaluates.
    static const std::wstring script =
        std::wstring(kNativeMediaTverCurrentPlayerSettingsScript) + L";" +
        kNativeMediaTverControlRecoveryScript;
    return script.c_str();
  } catch (...) {
    // Allocation failure must not disable playback recovery completely.
    return kNativeMediaTverControlRecoveryScript;
  }
}

// Kept as a narrow post-trusted-action verifier. Fullscreen targeting itself is
// owned by the unified runtime and its returned bottom-right video coordinate.
constexpr wchar_t kNativeMediaTverForceFullscreenAnyMediaScript[] =
#include "media_tver_playback_policy_force_fullscreen.inc"
;
constexpr const wchar_t* kNativeMediaTverForceFullscreenAdSafeScript =
    kNativeMediaTverForceFullscreenAnyMediaScript;
}  // namespace

#ifdef _MSC_VER
#pragma warning(disable : 6393)
#endif