// Spotify implementation is deliberately composed from static C++/JavaScript
// fragments. No ExecuteScript, timer, input, or layout call is rewritten by the
// preprocessor and no JavaScript source is generated or patched at runtime.
#include "spotify_static_scripts.inc"
#include "spotify_auth_badge.inc"
#include "spotify_phase_sync.inc"
#include "spotify_webviews.cpp"
#include "spotify_network_block.inc"
#include "spotify_host_layout.inc"
#include "spotify_timed_sequence.inc"
#include "spotify_recent_catalog.inc"
#include "spotify_timed_end_rotation.inc"

namespace hp {
#include "spotify_stagger_schedule.inc"
#include "spotify_background_click.inc"
}  // namespace hp
