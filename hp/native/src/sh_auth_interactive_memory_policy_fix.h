#pragma once

namespace hp {
namespace stationhead_auth_memory_policy {

// WebView2 documents LOW as a target for inactive WebViews and requires apps to
// restore NORMAL when the WebView becomes active. The Stationhead authorization
// controller is created specifically for an interactive OAuth flow and is shown
// immediately after configuration, so leaving it at LOW can keep its browser
// processes under cache-reduction and swap pressure for the entire login.
inline constexpr COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL
    kInteractiveAuthMemoryTarget =
        COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL;

static_assert(COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW !=
              COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL);
static_assert(kInteractiveAuthMemoryTarget ==
              COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL);

}  // namespace stationhead_auth_memory_policy
}  // namespace hp

// ConfigureAuthWebView is the repository's only LOW target call. Keep the source
// structure and low-memory feature flag intact, but compile that interactive
// controller request as NORMAL. Playback WebView memory policy is unchanged.
#undef COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW
#define COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW                              \
  ::hp::stationhead_auth_memory_policy::kInteractiveAuthMemoryTarget
