// Low-peak TVer episode policy. Playback state is maintained from media events
// and a narrowly scoped player observer. Large embedded JS is split by concern
// while remaining adjacent compile-time string literals.
namespace {
constexpr wchar_t kNativeMediaTverEpisodeLoopPolicyScript[] =
#include "media_tver_episode_loop_policy_part1.inc"
#include "media_tver_episode_loop_policy_part2a.inc"
#include "media_tver_episode_loop_policy_part2b_observer.inc"
#include "media_tver_episode_loop_policy_part2b_events.inc"
#include "media_tver_episode_loop_policy_part3a.inc"
#include "media_tver_episode_loop_policy_part3b.inc"
;
}  // namespace
