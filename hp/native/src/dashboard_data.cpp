#include "dashboard_data.h"
#include "json_helpers.h"
#include <winrt/Windows.Data.Json.h>

namespace hp {
namespace {
using winrt::Windows::Data::Json::JsonArray;
using winrt::Windows::Data::Json::JsonObject;
using winrt::Windows::Data::Json::JsonValueType;

std::string StringifyUtf8(const JsonObject& object) {
  const winrt::hstring text = object.Stringify();
  if (text.empty()) return {};
  const int inputSize = static_cast<int>(text.size());
  const int size = WideCharToMultiByte(
      CP_UTF8, WC_ERR_INVALID_CHARS, text.data(), inputSize,
      nullptr, 0, nullptr, nullptr);
  if (size <= 0) return {};
  std::string output(static_cast<size_t>(size), '\0');
  WideCharToMultiByte(
      CP_UTF8, WC_ERR_INVALID_CHARS, text.data(), inputSize,
      output.data(), size, nullptr, nullptr);
  return output;
}

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
  return Fnv1a64(StringifyUtf8(object));
}

bool CanReuseSection(const DashboardSnapshot* previous,
                     uint64_t DashboardSectionRevisions::* member,
                     uint64_t revision) {
  return previous && previous->loaded && previous->revisions.*member == revision;
}

double NumberOrNaN(const JsonObject& object, const wchar_t* name) {
  return json::Number(object, name, std::numeric_limits<double>::quiet_NaN());
}

std::wstring DeviceState(const JsonObject& item) {
  const std::wstring type = json::Text(item, L"deviceType");
  std::wstring state = L"接続";
  if (type.find(L"Contact") != std::wstring::npos) {
    state = json::Text(item, L"openState", L"-");
  } else if (type.find(L"Motion") != std::wstring::npos ||
             type.find(L"Presence") != std::wstring::npos) {
    state = json::Boolean(item, L"motion") ? L"検知" : L"静止";
  } else if (type.find(L"Plug") != std::wstring::npos) {
    state = L"--W";
    const double watts = NumberOrNaN(item, L"watts");
    if (std::isfinite(watts)) {
      wchar_t buffer[40]{};
      swprintf_s(buffer, L"%dW", static_cast<int>(std::round(watts)));
      state = buffer;
    }
  }
  const double battery = NumberOrNaN(item, L"battery");
  if (std::isfinite(battery)) {
    wchar_t buffer[24]{};
    swprintf_s(buffer, L" %d%%", static_cast<int>(std::round(battery)));
    state += buffer;
  }
  return state;
}
}  // namespace

bool ParseDashboardSnapshot(
    const std::string& text, DashboardSnapshot& output, std::wstring* error,
    const DashboardSnapshot* previous) {
  try {
    if (text.empty()) {
      if (error) *error = L"dashboard.json is empty";
      return false;
    }

    const JsonObject root = JsonObject::Parse(Utf8ToWide(text));
    DashboardSnapshot next;
    next.loaded = true;

    const JsonObject weather = json::Object(root, L"weather");
    next.revisions.weather = SourceRevision(weather);
    const std::wstring weatherStatus = json::Text(weather, L"__status", L"ok");
    next.weatherOutage = weatherStatus != L"ok";
    if (CanReuseSection(previous, &DashboardSectionRevisions::weather,
                        next.revisions.weather)) {
      next.weatherHours = previous->weatherHours;
    } else {
      const JsonObject hourly = json::Object(weather, L"hourly");
      const double startHourValue = json::Number(weather, L"startHour", 22);
      const int startHour = std::isfinite(startHourValue) && startHourValue >= 0 && startHourValue < 24
          ? static_cast<int>(startHourValue)
          : 22;
      next.weatherHours.reserve(12);
      for (int offset = 0; offset < 12; ++offset) {
        try {
          const int hour = (startHour + offset) % 24;
          const std::wstring key = std::to_wstring(hour);
          if (!hourly.HasKey(key.c_str())) continue;
          const auto value = hourly.GetNamedValue(key.c_str());
          if (value.ValueType() != JsonValueType::Object) continue;
          const JsonObject item = value.GetObject();
          next.weatherHours.push_back({
              hour,
              json::Text(item, L"icon"),
              NumberOrNaN(item, L"temp"),
              NumberOrNaN(item, L"rainMm"),
          });
        } catch (...) {
        }
      }
    }

    // The native News panel has been removed. Do not materialize up to ten
    // titles/descriptions or stringify the News object solely for a revision
    // that no visible panel consumes. The legacy snapshot fields stay empty so
    // older call sites remain harmless while using no dynamic News storage.

    const JsonObject octopus = json::Object(root, L"octopus");
    next.revisions.octopus = SourceRevision(octopus);
    if (CanReuseSection(previous, &DashboardSectionRevisions::octopus,
                        next.revisions.octopus)) {
      next.lastMonthUsage = previous->lastMonthUsage;
      next.projectedUsage = previous->projectedUsage;
      next.currentEnergyLabel = previous->currentEnergyLabel;
      next.previousEnergyLabel = previous->previousEnergyLabel;
      next.octopusProfile = previous->octopusProfile;
    } else {
      next.lastMonthUsage = NumberOrNaN(json::Object(octopus, L"lastMonth"), L"usage");
      next.projectedUsage =
          NumberOrNaN(json::Object(octopus, L"thisMonth"), L"projectedUsage");
      const JsonObject comparison = json::Object(octopus, L"comparison");
      next.currentEnergyLabel = json::Text(comparison, L"currentLabel", L"今週");
      next.previousEnergyLabel = json::Text(comparison, L"previousLabel", L"先週");

      const JsonArray profile = json::Array(octopus, L"profile");
      next.octopusProfile.reserve(7);
      for (uint32_t index = 0;
           index < profile.Size() && next.octopusProfile.size() < 7; ++index) {
        try {
          const auto value = profile.GetAt(index);
          if (value.ValueType() != JsonValueType::Object) continue;
          const JsonObject item = value.GetObject();
          const std::wstring day = json::Text(item, L"day");
          if (day.empty()) continue;
          const bool currentComplete = json::Boolean(item, L"currentComplete");
          const bool previousComplete = json::Boolean(item, L"previousComplete");
          double currentTotal = NumberOrNaN(item, L"currentTotal");
          double previousTotal = NumberOrNaN(item, L"previousTotal");
          if (!currentComplete) currentTotal = std::numeric_limits<double>::quiet_NaN();
          if (!previousComplete) previousTotal = std::numeric_limits<double>::quiet_NaN();
          next.octopusProfile.push_back(OctopusProfileData{
              day, currentTotal, previousTotal, currentComplete, previousComplete});
        } catch (...) {
        }
      }
    }

    const JsonObject switchbot = json::Object(root, L"switchbot");
    next.revisions.switchbot = SourceRevision(switchbot);
    if (CanReuseSection(previous, &DashboardSectionRevisions::switchbot,
                        next.revisions.switchbot)) {
      next.switchBotDevices = previous->switchBotDevices;
    } else {
      const JsonArray devices = json::Array(switchbot, L"devices");
      next.switchBotDevices.reserve(8);
      for (uint32_t index = 0;
           index < devices.Size() && next.switchBotDevices.size() < 8; ++index) {
        try {
          const auto value = devices.GetAt(index);
          if (value.ValueType() != JsonValueType::Object) continue;
          const JsonObject item = value.GetObject();
          const std::wstring type = json::Text(item, L"deviceType");
          if (type.find(L"Plug") == std::wstring::npos) continue;
          next.switchBotDevices.push_back({
              json::Text(item, L"deviceName",
                         json::Text(item, L"deviceId", L"SwitchBot")),
              DeviceState(item),
          });
        } catch (...) {
        }
      }
    }

    output = std::move(next);
    if (error) error->clear();
    return true;
  } catch (const winrt::hresult_error& exception) {
    if (error) *error = exception.message().c_str();
  } catch (const std::exception& exception) {
    if (error) *error = Utf8ToWide(exception.what());
  } catch (...) {
    if (error) *error = L"unknown dashboard parse error";
  }
  return false;
}

}  // namespace hp
