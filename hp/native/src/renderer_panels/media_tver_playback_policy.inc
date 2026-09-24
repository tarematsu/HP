// The TVer watchdog is the sole owner of the unified runtime.
// Action coordinates are returned to the native trusted-click dispatcher just
// like the YouTube control recovery path.
namespace {
constexpr const wchar_t* kNativeMediaTverPlaybackWatchdogPolicyScript =
    kNativeMediaTverControlRecoveryScript;

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
