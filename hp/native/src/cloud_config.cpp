#include "cloud_config.h"
#include "safe_json_number.h"
#include "winhttp_helpers.h"
#include <winrt/Windows.Data.Json.h>

namespace hp {
namespace {
using winrt::Windows::Data::Json::JsonArray;
using winrt::Windows::Data::Json::JsonObject;
using winrt::Windows::Data::Json::JsonValueType;

constexpr wchar_t kCanonicalPrimaryStationheadUrl[] =
    L"https://www.stationhead.com/sakuramankai";
constexpr wchar_t kCanonicalAlternateStationheadUrl[] =
    L"https://www.stationhead.com/buddy46";
constexpr wchar_t kStationheadPlaybackPreflightUrl[] =
    L"https://skrzk.pages.dev/api/dashboard?history=0";
constexpr size_t kStationheadPlaybackPreflightMaximumBytes = 4 * 1024 * 1024;

JsonObject Object(const JsonObject& parent, const wchar_t* key) {
  try { return parent.GetNamedObject(key); } catch (...) { return JsonObject{}; }
}
JsonArray Array(const JsonObject& parent, const wchar_t* key) {
  try { return parent.GetNamedArray(key); } catch (...) { return JsonArray{}; }
}
bool HasKey(const JsonObject& object, const wchar_t* key) {
  try { return object.HasKey(key); } catch (...) { return false; }
}
int Number(const JsonObject& object, const wchar_t* key, int fallback, int minimum, int maximum) {
  try {
    return ClampedJsonIntOr(
        object.GetNamedNumber(key, fallback), fallback, minimum, maximum);
  } catch (...) { return fallback; }
}
double Decimal(const JsonObject& object, const wchar_t* key, double fallback, double minimum, double maximum) {
  try {
    const double value = object.GetNamedNumber(key, fallback);
    return std::isfinite(value) ? std::clamp(value, minimum, maximum) : fallback;
  } catch (...) { return fallback; }
}
bool Boolean(const JsonObject& object, const wchar_t* key, bool fallback) {
  try { return object.GetNamedBoolean(key, fallback); } catch (...) { return fallback; }
}
std::wstring Text(const JsonObject& object, const wchar_t* key, const std::wstring& fallback) {
  try { return object.GetNamedString(key, fallback).c_str(); } catch (...) { return fallback; }
}

bool BooleanOrNumber(const JsonObject& object, const wchar_t* key,
                     bool fallback = false) {
  try {
    const auto value = object.GetNamedValue(key);
    if (value.ValueType() == JsonValueType::Boolean) return value.GetBoolean();
    if (value.ValueType() == JsonValueType::Number) return value.GetNumber() != 0;
  } catch (...) {
  }
  return fallback;
}

int Integer(const JsonObject& object, const wchar_t* key, int fallback = -1) {
  try {
    const double value = object.GetNamedNumber(key);
    if (!std::isfinite(value) ||
        value < static_cast<double>(std::numeric_limits<int>::min()) ||
        value > static_cast<double>(std::numeric_limits<int>::max())) {
      return fallback;
    }
    return static_cast<int>(std::trunc(value));
  } catch (...) {
    return fallback;
  }
}

bool PlaybackJsonHasUsableCurrentTrack(const std::wstring& payload) {
  if (payload.empty()) return false;
  try {
    const JsonObject root = JsonObject::Parse(payload);
    if (!BooleanOrNumber(root, L"ok") || BooleanOrNumber(root, L"stale") ||
        BooleanOrNumber(root, L"setup_required")) {
      return false;
    }

    const JsonArray queue = Array(root, L"queue");
    const JsonObject status = Object(root, L"queue_status");
    int markedCurrentIndex = -1;
    for (uint32_t index = 0; index < queue.Size(); ++index) {
      if (queue.GetAt(index).ValueType() != JsonValueType::Object) continue;
      const JsonObject item = queue.GetAt(index).GetObject();
      if (markedCurrentIndex < 0 && BooleanOrNumber(item, L"is_current")) {
        markedCurrentIndex = static_cast<int>(index);
      }
    }

    int currentIndex = Integer(status, L"current_index", markedCurrentIndex);
    if (currentIndex < 0 || currentIndex >= static_cast<int>(queue.Size())) {
      currentIndex = markedCurrentIndex;
    }
    if (currentIndex < 0 || currentIndex >= static_cast<int>(queue.Size()) ||
        BooleanOrNumber(status, L"is_paused") ||
        BooleanOrNumber(status, L"ended", BooleanOrNumber(root, L"ended")) ||
        !BooleanOrNumber(
            status, L"playing", BooleanOrNumber(root, L"playing"))) {
      return false;
    }

    if (queue.GetAt(static_cast<uint32_t>(currentIndex)).ValueType() !=
        JsonValueType::Object) {
      return false;
    }
    const JsonObject current =
        queue.GetAt(static_cast<uint32_t>(currentIndex)).GetObject();
    return !Text(current, L"title", L"").empty() ||
        !Text(current, L"artist", L"").empty() ||
        !Text(current, L"thumbnail_url", L"").empty();
  } catch (...) {
    return false;
  }
}

bool FetchPlaybackJsonBeforeStationheadWebView() {
  std::wstring requestUrl(kStationheadPlaybackPreflightUrl);
  requestUrl += L"&_hp=" + std::to_wstring(UnixMillis());

  std::vector<uint8_t> body;
  std::wstring error;
  if (!WinHttpDownload(
          requestUrl, kStationheadPlaybackPreflightMaximumBytes, &body, nullptr,
          &error, L"HomePanel-Stationhead-Preflight/1.0",
          L"Accept: application/json\r\nCache-Control: no-cache, no-store\r\nPragma: no-cache\r\n")) {
    return false;
  }
  const std::wstring payload = Utf8ToWide(std::string(body.begin(), body.end()));
  return PlaybackJsonHasUsableCurrentTrack(payload);
}

void ApplyStationheadStartupDestination(AppConfig& config) {
  config.stationhead.primaryUrl = kCanonicalPrimaryStationheadUrl;
  config.stationhead.alternateUrl = kCanonicalAlternateStationheadUrl;
  const bool primaryPlaybackAvailable =
      FetchPlaybackJsonBeforeStationheadWebView();
  const wchar_t* startupUrl = primaryPlaybackAvailable
      ? kCanonicalPrimaryStationheadUrl
      : kCanonicalAlternateStationheadUrl;
  config.stationhead.url = startupUrl;
  config.stationhead.secondaryUrl = startupUrl;
  config.stationhead.fallbackUrl.clear();
  config.stationhead.secondaryEnabled = true;
}
}  // namespace

bool ApplyCloudConfig(AppConfig& config, const fs::path& path) {
  // This executes from App::InitializePaths, before the main window and before
  // either Stationhead WebView2 controller is constructed. Network failure and
  // any playback JSON without a usable current track intentionally choose
  // buddy46 for the first navigation.
  ApplyStationheadStartupDestination(config);

  try {
    std::ifstream input(path, std::ios::binary);
    if (!input) return false;
    std::string text((std::istreambuf_iterator<char>(input)), {});
    if (text.empty()) return false;
    const auto envelope = JsonObject::Parse(Utf8ToWide(text));
    const auto root = Object(envelope, L"config");

    config.cloudPollSeconds = 1800;
    config.telemetryMinutes = 240;

    const auto screen = Object(root, L"screen");
    config.screenWidth = Number(screen, L"width", config.screenWidth, 320, 7680);
    config.screenHeight = Number(screen, L"height", config.screenHeight, 240, 4320);

    const auto co2 = Object(root, L"co2");
    config.serialPort = Text(co2, L"serialPort", config.serialPort);
    config.temperatureOffset = Decimal(co2, L"temperatureOffset", config.temperatureOffset, -20.0, 20.0);

    const auto station = Object(root, L"stationhead");
    // Station URLs are owned by the startup preflight above. Ignore stale URL
    // values from cloud configuration while still accepting resource settings.
    config.stationhead.channelId = Number(station, L"channelId", config.stationhead.channelId, 1, 100'000'000);
    config.stationhead.blockImages = HasKey(station, L"blockImages")
        ? Boolean(station, L"blockImages", config.stationhead.blockImages)
        : Boolean(station, L"blockImagesAfterPlayback", config.stationhead.blockImages);
    config.stationhead.blockFonts = HasKey(station, L"blockFonts")
        ? Boolean(station, L"blockFonts", config.stationhead.blockFonts)
        : Boolean(station, L"blockFontsAfterPlayback", config.stationhead.blockFonts);
    config.stationhead.lowMemoryMode = Boolean(station, L"lowMemoryMode", config.stationhead.lowMemoryMode);

    return true;
  } catch (...) {
    return false;
  }
}
}  // namespace hp
