#pragma once

#include "sh_auth_completion_message_policy_fix.h"
#include "sh_leaderboard_probe_message_policy.h"

// PR #48 lets the Stationhead player's own WebMessageReceived handler consume
// successful streakStats payloads and publish them through StationheadStatus.
// Keep the exact Stationhead-origin boundary outermost, capture only the
// dedicated leaderboard probe string messages, and preserve auth completion
// handling for every ordinary Stationhead message.
#undef add_WebMessageReceived
#define add_WebMessageReceived(handler, token)                                  \
  add_WebMessageReceived(                                                       \
      ::hp::stationhead_webview_policy::WrapStationheadWebMessageHandler(       \
          ::hp::stationhead_leaderboard_probe_message_policy::                  \
              WrapStationheadLeaderboardProbeMessageHandler(                    \
                  ::hp::stationhead_auth_completion_message_policy::            \
                      WrapStationheadAuthCompletionMessageHandler((handler))     \
                      .Get())                                                    \
              .Get())                                                           \
          .Get(),                                                               \
      (token))
