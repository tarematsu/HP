#pragma once
#include "common.h"

// StationheadPlayer used to own a dedicated Default profile. The restored
// single-window runtime instead reuses the existing amazon Spotify profile.
// Inject one narrowly-scoped pre-start setter while sh.h is parsed so the
// retained Stationhead implementation itself stays unchanged.
#define profileName_                                                         \
  profileName_;                                                              \
 public:                                                                     \
  void ReuseWebViewProfile(std::wstring profileName) {                       \
    if (!profileName.empty()) profileName_ = std::move(profileName);         \
  }                                                                          \
 private:                                                                    \
  int stationheadProfileReusePolicySentinel_

#include "sh.h"

#undef profileName_
