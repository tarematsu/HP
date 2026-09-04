#include "spotify_webviews.cpp"
#include "spotify_lonesome_guard.inc"
#define ExecuteScript(script, callback)                                         \
  ExecuteScript(RewriteSpotifyPhaseExecuteScript((script)), (callback))
#include "spotify_phase_sync.inc"
#undef ExecuteScript
}  // namespace hp
