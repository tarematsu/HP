#include "cloud_client.h"

namespace hp {
void CloudClient::RefreshCurrentSpotifySafely() noexcept {}
std::wstring CloudClient::BeginSpotifyAuthorization() { return {}; }
bool CloudClient::IsSpotifyAuthorizationRedirect(const std::wstring&) const { return false; }
bool CloudClient::CompleteSpotifyAuthorizationRedirect(const std::wstring&) { return false; }
void CloudClient::RefreshSpotifyNow() {}
void CloudClient::RequestSpotifyPollNow() noexcept {}
void CloudClient::SpotifyLoop() {}
void CloudClient::PollSpotify() {}
bool CloudClient::LoadSpotifyTokens() { return false; }
bool CloudClient::SaveSpotifyTokens() { return false; }
bool CloudClient::RefreshSpotifyAccessToken() { return false; }
bool CloudClient::ExchangeSpotifyCode(const std::wstring&) { return false; }
void CloudClient::WriteSpotifyUnavailable(const std::wstring&) {}
}  // namespace hp
