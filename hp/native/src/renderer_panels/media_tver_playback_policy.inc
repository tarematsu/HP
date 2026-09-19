// TVer episode-page watchdog. The page-local event policy reports state changes;
// this low-frequency fallback owns recovery actions and fullscreen retries.
// Embedded JS is split by concern while fullscreen configuration remains
// bounded per active video.
namespace {
constexpr wchar_t kNativeMediaTverPlaybackWatchdogPolicyScript[] =
#include "media_tver_playback_policy_guard.inc"
#include "media_tver_playback_policy_main1.inc"
#include "media_tver_playback_policy_main2.inc"
;

// Invoked immediately after a trusted TVer fullscreen action. The watchdog
// keeps retry ownership while this script only verifies the completed action.
constexpr wchar_t kNativeMediaTverForceFullscreenAnyMediaScript[] =
#include "media_tver_playback_policy_force_fullscreen.inc"
;
constexpr const wchar_t* kNativeMediaTverForceFullscreenAdSafeScript =
    kNativeMediaTverForceFullscreenAnyMediaScript;
}  // namespace

#ifdef _MSC_VER
// MSVC /analyze misclassifies the 365-character embedded TVer focus script in
// media_section.inc as a day-of-year lookup table. No day index is used here.
#pragma warning(disable : 6393)
#endif
