// Stable routing keys for the native media host.
//
// Historical TVer series-page playback, global DOM scanning and ad/fullscreen
// fallback scripts used to live here. Runtime routing now selects the focused
// episode event policy and trusted watchdog in media_section.inc, so keeping a
// second executable TVer implementation would only add code size and ambiguity.
namespace {
constexpr wchar_t kNativeMediaTverLoopStaticScript[] =
    L"null/*homepanel-tver-loop-routing-key*/";
constexpr wchar_t kNativeMediaTverWatchdogStaticScript[] =
    L"null/*homepanel-tver-watchdog-routing-key*/";
}  // namespace
