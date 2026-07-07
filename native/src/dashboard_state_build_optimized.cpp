#include "web_renderer.h"
#include <winrt/Windows.Data.Json.h>

namespace hp {
std::wstring Renderer::BuildStateJson(const RenderState& state, bool full) {
  try {
    std::ifstream input(dataDir_ / L"spotify.json", std::ios::binary);
    if (input) {
      const std::string text((std::istreambuf_iterator<char>(input)), {});
      if (!text.empty() && text != spotifyUtf8_) {
        const std::wstring wide = Utf8ToWide(text);
        winrt::Windows::Data::Json::JsonObject::Parse(wide);
        spotifyUtf8_ = text;
        spotifyJson_ = wide;
        ++spotifySourceRevision_;
      }
    }
  } catch (...) {
    // Atomic replacement can briefly race with a repaint. Keep the last valid state.
  }

  const int64_t now = UnixMillis();
  const StationheadStatus* player = &state.stationhead;
  std::optional<StationheadStatus> resolvedPlayer;
  int64_t elapsed = 0;
  if (cloudPlayback_.available) {
    const int index = ResolvePlaybackIndex(now, &elapsed);
    resolvedPlayer.emplace(state.stationhead);
    auto& resolved = *resolvedPlayer;
    if (index >= 0) {
      const auto& item = cloudPlayback_.queue[index];
      resolved.playing = cloudPlayback_.playing;
      resolved.trackTitle = item.name.empty() ? L"曲情報なし" : item.name;
      resolved.trackArtist = item.artist;
      resolved.artworkUrl = item.artwork;
      resolved.trackDurationMs = item.durationMs;
      if (cloudPlayback_.playing) {
        resolved.sampledAt = now - std::max<int64_t>(0, elapsed);
        resolved.expectedEndAt =
            item.durationMs > 0 ? resolved.sampledAt + item.durationMs : 0;
      } else {
        resolved.sampledAt = cloudPlayback_.sampledAt > 0 ? cloudPlayback_.sampledAt : now;
        resolved.expectedEndAt = item.durationMs > 0
            ? resolved.sampledAt + std::max<int64_t>(0, item.durationMs - elapsed)
            : 0;
      }
    } else {
      resolved.playing = false;
      resolved.trackTitle.clear();
      resolved.trackArtist.clear();
      resolved.artworkUrl.clear();
      resolved.trackDurationMs = 0;
      resolved.sampledAt = 0;
      resolved.expectedEndAt = 0;
    }
    player = &resolved;
  }

  const int64_t playbackEndAt =
      player->playing && player->expectedEndAt > now ? player->expectedEndAt : 0;
  if (scheduledPlaybackEndAt_ != playbackEndAt) {
    scheduledPlaybackEndAt_ = playbackEndAt;
    SchedulePlaybackInvalidate(window_, playbackEndAt > 0 ? playbackEndAt - now : 0);
  }

  const bool firstState = !stateJsonCache_.initialized;
  uint32_t changedFields = 0;

  if (firstState || stateJsonCache_.dashboardSourceRevision != dashboardSourceRevision_) {
    stateJsonCache_.dashboard = dashboardJson_.empty() ? L"{}" : dashboardJson_;
    stateJsonCache_.dashboardSourceRevision = dashboardSourceRevision_;
    ++stateJsonCache_.dashboardRevision;
    changedFields |= kDashboardSlice;
  }

  if (firstState || stateJsonCache_.spotifySourceRevision != spotifySourceRevision_) {
    stateJsonCache_.spotify = spotifyJson_.empty() ? L"{}" : spotifyJson_;
    stateJsonCache_.spotifySourceRevision = spotifySourceRevision_;
    ++stateJsonCache_.spotifyRevision;
    changedFields |= kSpotifySlice;
  }

  const int64_t airHistoryLastT = state.airHistory.empty() ? 0 : state.airHistory.back().timestamp;
  if (firstState || stateJsonCache_.airHistorySourceCount != state.airHistory.size() ||
      stateJsonCache_.airHistorySourceLastT != airHistoryLastT) {
    stateJsonCache_.airHistory = AirHistoryJson(state.airHistory);
    stateJsonCache_.airHistorySourceCount = state.airHistory.size();
    stateJsonCache_.airHistorySourceLastT = airHistoryLastT;
    ++stateJsonCache_.airHistoryRevision;
    changedFields |= kAirHistorySlice;
  }

  if (firstState || !SameSensors(stateJsonCache_.sensorsSource, state.sensors)) {
    stateJsonCache_.sensorsSource = state.sensors;
    stateJsonCache_.sensors = statejson::Sensors(state.sensors);
    ++stateJsonCache_.sensorsRevision;
    changedFields |= kSensorsSlice;
  }

  if (firstState || !SameStationhead(stateJsonCache_.stationheadSource, *player)) {
    stateJsonCache_.stationheadSource = *player;
    stateJsonCache_.stationhead = statejson::Player(*player);
    ++stateJsonCache_.stationheadRevision;
    changedFields |= kStationheadSlice;
  }

  if (firstState || stateJsonCache_.workspaceTab != state.workspaceTab) {
    changedFields |= kWorkspaceScalar;
  }
  if (firstState || stateJsonCache_.newsIndex != state.newsIndex) {
    changedFields |= kNewsIndexScalar;
    ++stateJsonCache_.newsRevision;
  }
  if (firstState || stateJsonCache_.toast != state.toast) {
    changedFields |= kToastScalar;
  }

  stateJsonCache_.workspaceTab = state.workspaceTab;
  stateJsonCache_.newsIndex = state.newsIndex;
  stateJsonCache_.toast = state.toast;
  stateJsonCache_.initialized = true;

  if (!full && changedFields == 0) return {};
  return BuildCachedStateJson(firstState ? kAllStateFields : changedFields, full);
}
}  // namespace hp
