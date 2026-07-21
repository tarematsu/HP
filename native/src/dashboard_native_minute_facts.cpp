#include "web_renderer.h"
#include "json_helpers.h"
#include <winrt/Windows.Data.Json.h>

namespace hp {
namespace {
using winrt::Windows::Data::Json::JsonObject;

int64_t DashboardEpochMilliseconds(double value) {
  if (!std::isfinite(value) || value <= 0) return 0;
  if (value < 100'000'000'000.0) value *= 1000.0;
  return static_cast<int64_t>(value);
}

NativeMinuteFactsProjection ParseDashboardStatus(const std::wstring& payload,
                                                  int64_t fetchedAt) {
  NativeMinuteFactsProjection projection;
  projection.fetchedAt = fetchedAt;
  if (payload.empty()) return projection;

  try {
    const JsonObject root = JsonObject::Parse(payload);
    projection.ok = json::Boolean(root, L"ok");
    if (!projection.ok) return projection;

    const JsonObject latest = json::Object(root, L"latest");
    if (latest.Size() == 0) return projection;
    const JsonObject queueStatus = json::Object(root, L"queue_status");

    projection.isBroadcasting =
        json::Number(latest, L"is_broadcasting") != 0;
    projection.isPaused = json::Boolean(queueStatus, L"is_paused");
    projection.listenerCount = static_cast<int>(std::max(
        0.0, json::Number(latest, L"listener_count")));
    projection.onlineMemberCount = static_cast<int>(std::max(
        0.0, json::Number(latest, L"online_member_count")));
    projection.minuteAt = DashboardEpochMilliseconds(
        json::Number(root, L"generated_at"));
    projection.available = true;
    return projection;
  } catch (...) {
    NativeMinuteFactsProjection failed;
    failed.fetchedAt = fetchedAt;
    return failed;
  }
}
}  // namespace

void Renderer::StartNativeMinuteFactsBridge() {
  nativeMinuteFactsStarted_ = true;
  nativeMinuteFactsStopping_ = false;
}

void Renderer::StopNativeMinuteFactsBridge() noexcept {
  nativeMinuteFactsStopping_ = true;
  nativeMinuteFactsStarted_ = false;
}

void Renderer::NativeMinuteFactsLoop() {
  // Stationhead status is projected from the dashboard JSON fetched by
  // NativePlaybackLoop. A second polling thread would duplicate the request.
}

NativeMinuteFactsProjection Renderer::NativeMinuteFactsSnapshot() const {
  std::wstring payload;
  int64_t fetchedAt = 0;
  {
    std::lock_guard lock(nativePlaybackMutex_);
    const NativePlaybackUpdate& update = nativePlaybackUpdates_[0];
    if (!update.hasPayload) return {};
    payload = update.payload;
    fetchedAt = update.fetchedAt;
  }
  return ParseDashboardStatus(payload, fetchedAt);
}

}  // namespace hp
