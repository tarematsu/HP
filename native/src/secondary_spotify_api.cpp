#include "secondary_sh.h"
#include "cloud_client.h"

namespace hp {

bool CloudClient::SpotifyAuthorizationRequired() { return false; }

void CloudClient::StartSpotifyAuthorizationBootstrap() {}

void MaybeStartSpotifyApiAuthorization(
    SecondaryStationheadPlayer*) noexcept {}

void SecondaryStationheadPlayer::StopSpotifyApiAuthorizationWorker() noexcept {
  if (apiAuthThread_.joinable()) apiAuthThread_.join();
  apiAuthExchangePending_ = false;
  apiAuthExchangeDone_ = false;
}

void SecondaryStationheadPlayer::PollSpotifyApiAuthorization() {}

void SecondaryStationheadPlayer::
    RestoreSecondaryAfterSpotifyApiAuthorization() {
  if (!shuttingDown_) {
    ShowInteractive(loginRequired_.load(std::memory_order_acquire));
  }
}

void SecondaryStationheadPlayer::StartSpotifyApiTokenExchange(
    const std::wstring&) {}

void SecondaryStationheadPlayer::ResetSpotifyApiAuthorization(
    const std::wstring& detail, bool) {
  apiAuthorization_ = false;
  spotifyAuthorization_ = false;
  apiAuthStartedAt_ = 0;
  {
    std::lock_guard lock(mutex_);
    status_.apiAuthorization = false;
    status_.spotifyAuthorization = false;
    status_.navigating = false;
    if (!detail.empty()) status_.detail = detail;
  }
}

bool SecondaryStationheadPlayer::OpenSpotifyApiAuthorization(
    const std::wstring&) {
  ResetSpotifyApiAuthorization(L"", false);
  return false;
}

}  // namespace hp
