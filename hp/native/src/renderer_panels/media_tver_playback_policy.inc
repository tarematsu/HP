// TVer episode-page watchdog. The page-local event policy owns ordinary state;
// this low-frequency fallback only performs recovery actions. Embedded JS is
// split by concern while fullscreen configuration remains one-shot per video.
namespace {
constexpr wchar_t kNativeMediaTverPlaybackWatchdogPolicyScript[] =
#include "media_tver_playback_policy_guard.inc"
#include "media_tver_playback_policy_main1.inc"
#include "media_tver_playback_policy_main2.inc"
;

// Invoked immediately after a trusted TVer click. The fallback itself observes
// fullscreenDirty, so the per-video fullscreen request is never repeated.
constexpr wchar_t kNativeMediaTverForceFullscreenAnyMediaScript[] =
#include "media_tver_playback_policy_force_fullscreen.inc"
;
}  // namespace
