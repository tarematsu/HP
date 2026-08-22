#pragma once

#include "sh_auth_completion_message_policy_fix.h"

// PR #48 lets the Stationhead player's own WebMessageReceived handler consume
// successful streakStats payloads and publish them through StationheadStatus.
// Keep only the existing origin/auth-completion wrappers here; do not intercept
// play-count messages into the later native stats store.
#undef add_WebMessageReceived
#define add_WebMessageReceived(handler, token)                                  \
  add_WebMessageReceived(                                                       \
      ::hp::stationhead_webview_policy::WrapStationheadWebMessageHandler(       \
          ::hp::stationhead_auth_completion_message_policy::                    \
              WrapStationheadAuthCompletionMessageHandler((handler)).Get())     \
          .Get(),                                                               \
      (token))
