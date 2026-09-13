#pragma once
#include "common.h"

// sh_track_boundary_message_policy.h is the final policy that parses sh.h.
// Piggyback on an otherwise ordinary private bool member so the one restored
// Stationhead instance can select the existing amazon WebView2 profile without
// moving the injection ahead of the established Stationhead policy chain.
#define autoClickInFlight_                                                   \
  autoClickInFlight_ = false;                                                \
 public:                                                                     \
  void ReuseWebViewProfile(std::wstring profileName) {                       \
    if (!profileName.empty()) profileName_ = std::move(profileName);         \
  }                                                                          \
 private:                                                                    \
  bool stationheadProfileReusePolicySentinel_
