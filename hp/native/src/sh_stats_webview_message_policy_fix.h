#pragma once

#include "sh_auth_completion_message_policy_fix.h"

// Preserve origin validation and authentication-completion handling for
// Stationhead page messages. Leaderboard capture uses a separate WebView2.
#undef add_WebMessageReceived
#define add_WebMessageReceived(handler, token)                                  \
  add_WebMessageReceived(                                                       \
      ::hp::stationhead_webview_policy::WrapStationheadWebMessageHandler(       \
          ::hp::stationhead_auth_completion_message_policy::                    \
              WrapStationheadAuthCompletionMessageHandler((handler))            \
              .Get())                                                           \
          .Get(),                                                               \
      (token))
