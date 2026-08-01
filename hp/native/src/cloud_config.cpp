#include "cloud_config.h"
#include "safe_json_number.h"
#include "stationhead_playback_gate.h"
#include <winrt/Windows.Data.Json.h>

namespace hp {
namespace {
using winrt::Windows::Data::Json::JsonObject;
constexpr wchar_t kCanonicalPrimaryStationheadUrl[] =
    L"https://www.stationhead.com/sakuramankai";
constexpr wchar_t kCanonicalAlternateStationheadUrl[] =
    L"https://www.stationhead.com/buddy46";

JsonObject Object(const JsonObject& parent, const wchar_t* key) {
  try { return parent.GetNamedObject(key); } catch (...) { return JsonObject{}; }
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

void ApplyStationheadStartupDestination(AppConfig& config) {
  config.stationhead.primaryUrl = kCanonicalPrimaryStationheadUrl;
  config.stationhead.alternateUrl = kCanonicalAlternateStationheadUrl;
  const wchar_t* startupUrl = StationheadPrimaryPlaybackAvailableNow()
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
