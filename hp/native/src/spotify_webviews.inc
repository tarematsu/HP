// Spotify implementation is deliberately composed from static C++/JavaScript
// fragments. Runtime code selects the stricter startup reconcile wrapper at
// compile time; JavaScript is not generated or patched after startup.
#include "spotify_static_scripts.inc"
#include "spotify_scoped_track_reconcile.inc"
#include "spotify_strict_track_start_reconcile.inc"
#include "spotify_media_observer_runtime.inc"
#include "spotify_media_observer_events.inc"
#include "spotify_fast_end_observer.inc"
#include "spotify_runtime_policy.inc"
#include "spotify_media_start_evidence.inc"
#include "spotify_phase_sync.inc"
#include "spotify_process_title_status.inc"
#include "spotify_webviews.cpp"
#include "spotify_network_block.inc"
#include "spotify_host_layout.inc"
#include "spotify_cloud_playlist.inc"
#include "spotify_timed_sequence.inc"
#include "spotify_rotation_cycle.inc"
#define kSpotifyScopedTrackReconcileScript kSpotifyStrictScopedTrackReconcileScript
#include "spotify_music_target.inc"
#undef kSpotifyScopedTrackReconcileScript
#include "spotify_target_routing.inc"
#include "spotify_timed_end_rotation.inc"
#include "spotify_startup_audio_recovery.inc"

namespace hp {
#include "spotify_stagger_schedule.inc"
#include "spotify_background_click.inc"
}  // namespace hp
