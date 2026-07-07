#include "cloud_spotify_auth_impl.inc"

namespace hp {
namespace {
constexpr int64_t kFixedSpotifyPollIntervalMs = 5 * 60'000;

class SpotifyFixedPollGate {
 public:
  SpotifyFixedPollGate() : thread_([this] { Run(); }) {}

  ~SpotifyFixedPollGate() {
    stop_ = true;
    if (thread_.joinable()) thread_.join();
  }

 private:
  void Run() noexcept {
    int64_t enforcedAt = 0;
    while (!stop_) {
      const int64_t now = UnixMillis();
      const int64_t scheduled =
          gSpotifyNextPollAt.load(std::memory_order_acquire);

      if (enforcedAt > 0 && now >= enforcedAt) {
        enforcedAt = 0;
        gSpotifyNextPollAt.store(0, std::memory_order_release);
      } else if (scheduled <= 0) {
        // Preserve explicit startup and reauthorization refresh requests.
        enforcedAt = 0;
      } else if (enforcedAt <= 0 || scheduled != enforcedAt) {
        // PollSpotify still computes track-aware intervals internally. Replace
        // every resulting schedule with the requested fixed five-minute check.
        enforcedAt = now + kFixedSpotifyPollIntervalMs;
        gSpotifyNextPollAt.store(enforcedAt, std::memory_order_release);
      }

      for (int i = 0; i < 10 && !stop_; ++i) Sleep(100);
    }
  }

  std::atomic<bool> stop_{false};
  std::thread thread_;
};

// Constructed after the existing Spotify runtime and destroyed before it.
SpotifyFixedPollGate gSpotifyFixedPollGate;
}  // namespace

void CloudClient::RequestSpotifyPollNow() noexcept {
  gSpotifyNextPollAt.store(0, std::memory_order_release);
}
}  // namespace hp
