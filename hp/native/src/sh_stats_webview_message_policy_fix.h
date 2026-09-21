#pragma once

#include "sh_auth_completion_message_policy_fix.h"

// PR #48 lets the Stationhead player's own WebMessageReceived handler consume
// successful streakStats payloads and publish them through StationheadStatus.
// Keep the exact Stationhead-origin boundary outermost and preserve auth
// completion handling for every ordinary Stationhead message. Leaderboard
// collection is isolated in its own hidden WebView2 and does not participate in
// the playback WebMessage pipeline.
#undef add_WebMessageReceived
#define add_WebMessageReceived(handler, token)                                  \
  add_WebMessageReceived(                                                       \
      ::hp::stationhead_webview_policy::WrapStationheadWebMessageHandler(       \
          ::hp::stationhead_auth_completion_message_policy::                    \
              WrapStationheadAuthCompletionMessageHandler((handler))            \
              .Get())                                                           \
          .Get(),                                                               \
      (token))
