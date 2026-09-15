#include "dashboard_data.h"
#include "json_helpers.h"
#include <winrt/Windows.Data.Json.h>

namespace hp {
namespace {
using winrt::Windows.Data::Json::JsonArray;
using winrt::Windows.Data::Json::JsonObject;
using winrt::Windows.Data::Json::JsonValueType;

uint64_t SourceRevision(const JsonObject& object) {
  const double rawVersion = json::Number(object, L"__version", -1);
  if (std::isfinite(rawVersion) && rawVersion >= 0 &&
      rawVersion <= static_cast<double>(std::numeric_limits<uint64_t>::max() >> 2)) {
    const std::wstring status = json::Text(object, L"__status", L"ok");
    const uint64_t statusCode = status == L"ok" ? 0 :
        status == L"stale" ? 1 : status == L"error" ? 2 : 3;
    return (static_cast<uint64_t>(rawVersion) << 2) | statusCode;
  }

  // Compatibility fallback for old cached dashboard files that predate
  // source-level __version metadata. Normal cloud payloads never take this path.
  return Fnv1a64(WideToUtf8(std::wstring{object.Stringify().c_str()}));
}

double NumberOrNaN(const JsonObject& object, const wchar_t* name) {
  return json::Number(object, name, std::numeric_limits<double>::quiet_NaN());
}

double CompleteTotal(const JsonObject& object, const wchar_t* complete,
                     const wchar_t* total) {
  return json::Boolean(object, complete) ? NumberOrNaN(object, total)
                                         : std::numeric_limits<double>::quiet_NaN();
}
}  // namespace

bool ParseDashboardSnapshot(const std::string& text, DashboardSnapshot& output,
                            const DashboardSnapshot* previous) {
  try {
    if (text.empty()) return false;

    const JsonObject root = JsonObject::Parse(Utf8ToWide(text));
    DashboardSnapshot next = previous ? *previous : DashboardSnapshot{};

    const JsonObject weather = json::Object(root, L"weather");
    next.revisions.weather = SourceRevision(weather);
    if (!previous || previous->revisions.weather != next.revisions.weather) {
      next.weatherHours.clear();
      if (json::Text(weather, L"__status", L"ok") == L"ok") {
        const JsonObject hourly = json::Object(weather, L"hourly");
        const int startHour = static_cast<int>(json::Number(weather, L"startHour", 22));
        for (int offset = 0; offset < 12; ++offset) {
          const int hour = (startHour + offset) % 24;
          const JsonObject item = json::Object(hourly, std::to_wstring(hour).c_str());
          if (item.Size() == 0) continue;
          next.weatherHours.push_back({
              hour,
              json::Text(item, L"icon"),
              NumberOrNaN(item, L"temp"),
              NumberOrNaN(item, L"rainMm"),
          });
        }
      }
    }

    const JsonObject octopus = json::Object(root, L"octopus");
    next.revisions.octopus = SourceRevision(octopus);
    if (!previous || previous->revisions.octopus != next.revisions.octopus) {
      next.lastMonthUsage = NumberOrNaN(json::Object(octopus, L"lastMonth"), L"usage");
      next.projectedUsage =
          NumberOrNaN(json::Object(octopus, L"thisMonth"), L"projectedUsage");
      const JsonObject comparison = json::Object(octopus, L"comparison");
      next.currentEnergyLabel = json::Text(comparison, L"currentLabel", L"今週");
      next.previousEnergyLabel = json::Text(comparison, L"previousLabel", L"先週");

      next.octopusProfile.clear();
      const JsonArray profile = json::Array(octopus, L"profile");
      next.octopusProfile.reserve(7);
      for (uint32_t index = 0;
           index < profile.Size() && next.octopusProfile.size() < 7; ++index) {
        const auto value = profile.GetAt(index);
        if (value.ValueType() != JsonValueType::Object) continue;
        const JsonObject item = value.GetObject();
        const std::wstring day = json::Text(item, L"day");
        if (day.empty()) continue;
        next.octopusProfile.push_back({
            day,
            CompleteTotal(item, L"currentComplete", L"currentTotal"),
            CompleteTotal(item, L"previousComplete", L"previousTotal"),
        });
      }
    }

    output = std::move(next);
    return true;
  } catch (...) {
    return false;
  }
}

bool ParseSwitchBotDevices(const std::string& text,
                           std::vector<SwitchBotDeviceData>& output) {
  try {
    if (text.empty()) return false;
    const JsonArray devices = json::Array(JsonObject::Parse(Utf8ToWide(text)), L"devices");
    std::vector<SwitchBotDeviceData> next;
    next.reserve(4);
    for (uint32_t index = 0; index < devices.Size() && next.size() < 4; ++index) {
      const auto value = devices.GetAt(index);
      if (value.ValueType() != JsonValueType::Object) continue;
      const JsonObject item = value.GetObject();
      if (json::Text(item, L"deviceType").find(L"Plug") == std::wstring::npos) continue;
      const double watts = NumberOrNaN(item, L"watts");
      next.push_back({
          json::Text(item, L"deviceName",
                     json::Text(item, L"deviceId", L"SwitchBot")),
          std::isfinite(watts)
              ? std::to_wstring(static_cast<int>(std::round(watts))) + L"W" : L"--W",
      });
    }
    output = std::move(next);
    return true;
  } catch (...) {
    return false;
  }
}

}  // namespace hp
