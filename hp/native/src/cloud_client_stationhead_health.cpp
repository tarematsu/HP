// Dormant Stationhead cloud-health projection. The source remains available for
// future re-enablement, while active device sync can skip the payload entirely.
#include "cloud_client.h"
#include <winrt/Windows.Data.Json.h>

namespace hp {
namespace {
bool NativeStationheadSyncEnabled() noexcept {
  return false;
}

int64_t HealthNumber(const JsonObject& root, const wchar_t* name) {
  try {
    const double value = root.GetNamedNumber(name, -1);
    return std::isfinite(value) && value >= 0 ? static_cast<int64_t>(value) : -1;
  } catch (...) {
    return -1;
  }
}

std::wstring HealthTimeText(int64_t timestampMs) {
  if (timestampMs < 0) return L"--:--";
  const std::time_t seconds = static_cast<std::time_t>(timestampMs / 1000);
  std::tm local{};
  if (localtime_s(&local, &seconds) != 0) return L"--:--";
  wchar_t text[16]{};
  swprintf_s(text, L"%02d:%02d", local.tm_hour, local.tm_min);
  return text;
}

std::wstring StationheadHealthSummary(const JsonObject& root) {
  const bool configured = root.GetNamedBoolean(L"configured", false);
  if (!configured) return L"Stationhead収集: 未設定";

  const bool reachable = root.GetNamedBoolean(L"reachable", false);
  const bool healthy = root.GetNamedBoolean(L"healthy", false);
  const int64_t lastSuccessAt = HealthNumber(root, L"lastSuccessAt");
  const std::wstring lastSuccess = HealthTimeText(lastSuccessAt);
  if (!reachable) return L"Stationhead収集: 状態取得失敗";

  std::wstring result = healthy
      ? L"Stationhead収集: 稼働中"
      : L"Stationhead収集: 停止";
  result += L"  最終成功 " + lastSuccess;
  if (lastSuccessAt >= 0) {
    const int64_t ageMinutes =
        std::max<int64_t>(0, (UnixMillis() - lastSuccessAt) / 60'000);
    if (ageMinutes < 24 * 60) {
      result += L" (" + std::to_wstring(ageMinutes) + L"分前)";
    }
  }
  return result;
}
}  // namespace

std::wstring CloudClient::StationheadHealthText() const {
  std::lock_guard lock(stateMutex_);
  return stationheadHealthText_;
}

}  // namespace hp
