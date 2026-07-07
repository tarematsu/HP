#include "dashboard_data.h"
#include <winrt/Windows.Data.Json.h>

namespace hp {
namespace {
using winrt::Windows::Data::Json::JsonArray;
using winrt::Windows::Data::Json::JsonObject;
using winrt::Windows::Data::Json::JsonValueType;

JsonObject ObjectOrEmpty(const JsonObject& parent, const wchar_t* name) {
  try {
    if (parent.HasKey(name) && parent.GetNamedValue(name).ValueType() == JsonValueType::Object) {
      return parent.GetNamedObject(name);
    }
  } catch (...) {
  }
  return JsonObject{};
}

JsonArray ArrayOrEmpty(const JsonObject& parent, const wchar_t* name) {
  try {
    if (parent.HasKey(name) && parent.GetNamedValue(name).ValueType() == JsonValueType::Array) {
      return parent.GetNamedArray(name);
    }
  } catch (...) {
  }
  return JsonArray{};
}

std::wstring StringOr(const JsonObject& object, const wchar_t* name, const std::wstring& fallback = {}) {
  try {
    if (object.HasKey(name) && object.GetNamedValue(name).ValueType() == JsonValueType::String) {
      return object.GetNamedString(name).c_str();
    }
  } catch (...) {
  }
  return fallback;
}

double NumberOrNaN(const JsonObject& object, const wchar_t* name) {
  try {
    if (object.HasKey(name) && object.GetNamedValue(name).ValueType() == JsonValueType::Number) {
      return object.GetNamedNumber(name);
    }
  } catch (...) {
  }
  return std::numeric_limits<double>::quiet_NaN();
}

bool BoolOr(const JsonObject& object, const wchar_t* name, bool fallback = false) {
  try {
    if (object.HasKey(name) && object.GetNamedValue(name).ValueType() == JsonValueType::Boolean) {
      return object.GetNamedBoolean(name);
    }
  } catch (...) {
  }
  return fallback;
}

PanelDataStatus ReadStatus(const JsonObject& object) {
  PanelDataStatus status;
  const std::wstring value = StringOr(object, L"__status", L"waiting");
  status.state = value == L"ok" ? PanelDataState::Ok
      : value == L"stale" ? PanelDataState::Stale
      : value == L"error" ? PanelDataState::Error
      : PanelDataState::Waiting;
  status.error = StringOr(object, L"__error");
  const double lastSuccess = NumberOrNaN(object, L"__lastSuccessAt");
  if (std::isfinite(lastSuccess)) status.lastSuccessAt = static_cast<int64_t>(lastSuccess);
  return status;
}

void ApplyCloudError(PanelDataStatus& status, const std::wstring& error) {
  if (error.empty()) return;
  status.error = error;
  status.state = status.state == PanelDataState::Ok ? PanelDataState::Stale : PanelDataState::Error;
}

std::wstring Upper(std::wstring value) {
  std::transform(value.begin(), value.end(), value.begin(), towupper);
  return value;
}

std::wstring DeviceState(const JsonObject& item) {
  const std::wstring type = StringOr(item, L"deviceType");
  std::wstring state = L"接続";
  if (type.find(L"Contact") != std::wstring::npos) {
    state = StringOr(item, L"openState", L"-");
  } else if (type.find(L"Motion") != std::wstring::npos || type.find(L"Presence") != std::wstring::npos) {
    state = BoolOr(item, L"motion") ? L"検知" : L"静止";
  } else if (type.find(L"Plug") != std::wstring::npos) {
    state = Upper(StringOr(item, L"power", L"-"));
    const double watts = NumberOrNaN(item, L"watts");
    if (std::isfinite(watts)) {
      wchar_t buffer[40]{};
      swprintf_s(buffer, L" %.1fW", watts);
      state += buffer;
    }
  }
  const double battery = NumberOrNaN(item, L"battery");
  if (std::isfinite(battery)) {
    state += L" " + std::to_wstring(static_cast<int>(std::round(battery))) + L"%";
  }
  return state;
}
}  // namespace

bool LoadDashboardSnapshot(const fs::path& path, DashboardSnapshot& output, std::wstring* error) {
  try {
    std::ifstream input(path, std::ios::binary);
    if (!input) {
      if (error) *error = L"dashboard.json not found";
      return false;
    }
    const std::string text((std::istreambuf_iterator<char>(input)), {});
    if (text.empty()) {
      if (error) *error = L"dashboard.json is empty";
      return false;
    }

    const JsonObject root = JsonObject::Parse(Utf8ToWide(text));
    DashboardSnapshot next;
    next.loaded = true;
    next.cloudError = StringOr(root, L"__cloudError");

    const JsonObject weather = ObjectOrEmpty(root, L"weather");
    next.weatherStatus = ReadStatus(weather);
    next.city = StringOr(weather, L"city");
    const JsonObject average = ObjectOrEmpty(weather, L"average");
    for (int hour = 0; hour < 24 && next.weatherHours.size() < 8; ++hour) {
      const std::wstring key = std::to_wstring(hour);
      try {
        if (!average.HasKey(key) || average.GetNamedValue(key).ValueType() != JsonValueType::Object) continue;
        const JsonObject item = average.GetNamedObject(key);
        next.weatherHours.push_back({
            hour,
            NumberOrNaN(item, L"temp"),
            NumberOrNaN(item, L"pop"),
            NumberOrNaN(item, L"rainMm"),
        });
      } catch (...) {
      }
    }

    const JsonObject news = ObjectOrEmpty(root, L"news");
    next.newsStatus = ReadStatus(news);
    const JsonArray newsItems = ArrayOrEmpty(news, L"items");
    for (uint32_t index = 0; index < newsItems.Size() && index < 10; ++index) {
      try {
        if (newsItems.GetAt(index).ValueType() != JsonValueType::Object) continue;
        const JsonObject item = newsItems.GetObjectAt(index);
        const std::wstring title = StringOr(item, L"title");
        if (!title.empty()) next.newsItems.push_back({title, StringOr(item, L"description")});
      } catch (...) {
      }
    }

    const JsonObject octopus = ObjectOrEmpty(root, L"octopus");
    next.octopusStatus = ReadStatus(octopus);
    next.lastMonthUsage = NumberOrNaN(ObjectOrEmpty(octopus, L"lastMonth"), L"usage");
    next.projectedUsage = NumberOrNaN(ObjectOrEmpty(octopus, L"thisMonth"), L"projectedUsage");
    const JsonArray history = ArrayOrEmpty(octopus, L"history");
    const uint32_t historyStart = history.Size() > 10 ? history.Size() - 10 : 0;
    for (uint32_t index = historyStart; index < history.Size(); ++index) {
      try {
        if (history.GetAt(index).ValueType() != JsonValueType::Object) continue;
        const JsonObject item = history.GetObjectAt(index);
        next.octopusHistory.push_back({StringOr(item, L"date"), NumberOrNaN(item, L"value")});
      } catch (...) {
      }
    }

    const JsonObject switchbot = ObjectOrEmpty(root, L"switchbot");
    next.switchBotStatus = ReadStatus(switchbot);
    next.switchBotPresence = StringOr(switchbot, L"presence", L"unknown");
    next.switchBotBrightness = StringOr(switchbot, L"brightness", L"unknown");
    next.switchBotDoorOpen = BoolOr(switchbot, L"doorOpen");
    next.switchBotMotion = BoolOr(switchbot, L"motion");
    const JsonArray devices = ArrayOrEmpty(switchbot, L"devices");
    for (uint32_t index = 0; index < devices.Size() && index < 8; ++index) {
      try {
        if (devices.GetAt(index).ValueType() != JsonValueType::Object) continue;
        const JsonObject item = devices.GetObjectAt(index);
        next.switchBotDevices.push_back({
            StringOr(item, L"deviceName", StringOr(item, L"deviceId", L"SwitchBot")),
            DeviceState(item),
        });
      } catch (...) {
      }
    }

    ApplyCloudError(next.weatherStatus, next.cloudError);
    ApplyCloudError(next.newsStatus, next.cloudError);
    ApplyCloudError(next.octopusStatus, next.cloudError);
    ApplyCloudError(next.switchBotStatus, next.cloudError);
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
