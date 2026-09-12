// YouTube watchdog policy.
//
// Keep ad handling and content recovery as adjacent compile-time string
// fragments. This lets content playback settings remain strict one-shot state
// without coupling them to the independent ad-control policy.
namespace {
constexpr wchar_t kNativeMediaYoutubeControlRecoveryScript[] =
#include "media_youtube_control_recovery_ad.inc"
#include "media_youtube_control_recovery_content.inc"
;
}  // namespace
