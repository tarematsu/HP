// Spotify implementation is deliberately composed from static C++/JavaScript
// fragments. No ExecuteScript, timer, input, or layout call is rewritten by the
// preprocessor and no JavaScript source is generated or patched at runtime.
#include "spotify_static_scripts.inc"
#include "spotify_scoped_track_reconcile.inc"
#include "spotify_media_observer_runtime.inc"
#include "spotify_media_observer_completion.inc"
#include "spotify_media_observer_events.inc"
#include "spotify_fast_end_observer.inc"
#include "spotify_auth_badge.inc"
#include "spotify_phase_sync.inc"
#include "spotify_webviews.cpp"
#include "spotify_playback_mode_guards.inc"
#include "spotify_network_block.inc"
#include "spotify_host_layout.inc"
#include "spotify_cloud_playlist.inc"

// Keep existing call sites static while routing music reconciliation through the
// now-playing-scoped identity implementation. Podcast reconciliation stays on
// the established fixed script. Rotation construction, music control, and
// music/podcast routing are kept in separate responsibility modules.
#define kSpotifyStaticTrackReconcileScript kSpotifyScopedTrackReconcileScript
#include "spotify_timed_sequence.inc"
#include "spotify_rotation_cycle.inc"
#include "spotify_music_target.inc"
#include "spotify_target_routing.inc"
#undef kSpotifyStaticTrackReconcileScript

#include "spotify_timed_end_rotation.inc"

namespace hp {
#include "spotify_stagger_schedule.inc"
#include "spotify_background_click.inc"
}  // namespace hp
