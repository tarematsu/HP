#include "cloud_config.h"
#include <winrt/Windows.Data.Json.h>

namespace hp {
namespace {
using winrt::Windows::Data::Json::JsonObject;
constexpr wchar_t kCanonicalSecondaryStationheadUrl[] = L"https://www.stationhead.com/buddy46";
JsonObject Object(const JsonObject& parent, const wchar_t* key) {
  try { return parent.GetNamedObject(key); } catch (...) { return JsonObject{}; }
}
bool HasKey(const JsonObject& object, const wchar_t* key) {
  try { return object.HasKey(key); } catch (...) { return false; }
}
int Number(const JsonObject& object, const wchar_t* key, int fallback, int minimum, int maximum) {
  try {
    const double value = object.GetNamedNumber(key, fallback);
    return std::isfinite(value) ? std::clamp(static_cast<int>(value), minimum, maximum) : fallback;
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
}  // namespace

bool ApplyCloudConfig(AppConfig& config, const fs::path& path) {
  try {
    std::ifstream input(path, std::ios::binary);
    if (!input) return false;
    std::string text((std::istreambuf_iterator<char>(input)), {});
    if (text.empty()) return false;
    const auto envelope = JsonObject::Parse(Utf8ToWide(text));
    const auto root = Object(envelope, L"config");

    config.cloudPollSeconds = 300;
    config.telemetryMinutes = 30;

    const auto screen = Object(root, L"screen");
    config.screenWidth = Number(screen, L"width", config.screenWidth, 320, 7680);
    config.screenHeight = Number(screen, L"height", config.screenHeight, 240, 4320);

    const auto co2 = Object(root, L"co2");
    config.serialPort = Text(co2, L"serialPort", config.serialPort);
    config.temperatureOffset = Decimal(co2, L"temperatureOffset", config.temperatureOffset, -20.0, 20.0);

    const auto station = Object(root, L"stationhead");
    config.stationhead.url = Text(station, L"url", config.stationhead.url);
    if (_wcsicmp(config.stationhead.url.c_str(), L"https://www.stationhead.com/sakuramankaisv") == 0) {
      config.stationhead.url = L"https://www.stationhead.com/sakuramankai";
    }
    config.stationhead.fallbackUrl = Text(station, L"fallbackUrl", config.stationhead.fallbackUrl);
    config.stationhead.sakurazakaUrl = Text(station, L"sakurazakaUrl", config.stationhead.sakurazakaUrl);
    config.stationhead.sakurazakaHandle = Text(station, L"sakurazakaHandle", config.stationhead.sakurazakaHandle);
    config.stationhead.audioFallbackSeconds = 0;
    config.stationhead.reloadIntervalMinutes = Number(station, L"reloadIntervalMinutes", config.stationhead.reloadIntervalMinutes, 1, 1440);
    config.stationhead.healthCheckIntervalSeconds = Number(station, L"healthCheckIntervalSeconds", config.stationhead.healthCheckIntervalSeconds, 5, 3600);
    config.stationhead.restartAfterHealthMisses = Number(station, L"restartAfterHealthMisses", config.stationhead.restartAfterHealthMisses, 1, 100);
    config.stationhead.blockImagesAfterPlayback = Boolean(station, L"blockImagesAfterPlayback", config.stationhead.blockImagesAfterPlayback);
    config.stationhead.blockFontsAfterPlayback = Boolean(station, L"blockFontsAfterPlayback", config.stationhead.blockFontsAfterPlayback);
    config.stationhead.hideChatAfterPlayback = Boolean(station, L"hideChatAfterPlayback", config.stationhead.hideChatAfterPlayback);
    config.stationhead.lowMemoryMode = Boolean(station, L"lowMemoryMode", config.stationhead.lowMemoryMode);
    config.stationhead.memoryLimitMb = static_cast<size_t>(Number(
        station, L"memoryLimitMb", static_cast<int>(config.stationhead.memoryLimitMb), 128, 4096));

    const auto secondary = Object(station, L"secondary");
    config.stationhead.secondaryEnabled = Boolean(secondary, L"enabled", config.stationhead.secondaryEnabled);
    config.stationhead.secondaryUrl = HasKey(secondary, L"url")
        ? Text(secondary, L"url", config.stationhead.fallbackUrl)
        : config.stationhead.fallbackUrl;
    if (config.stationhead.secondaryUrl.empty()) config.stationhead.secondaryUrl = config.stationhead.fallbackUrl;
    // Window B is fixed to buddy46. Older device-config caches can otherwise
    // resurrect the previous secondary station, because humans invented stale
    // configuration and then called it state management.
    if (_wcsicmp(config.stationhead.secondaryUrl.c_str(), kCanonicalSecondaryStationheadUrl) != 0) {
      config.stationhead.secondaryUrl = kCanonicalSecondaryStationheadUrl;
    }
    config.stationhead.secondaryStartDelaySeconds = Number(
        secondary, L"startDelaySeconds", config.stationhead.secondaryStartDelaySeconds, 1, 120);
    config.stationhead.secondaryViewportWidth = Number(
        secondary, L"viewportWidth", config.stationhead.secondaryViewportWidth, 320, 1920);
    config.stationhead.secondaryViewportHeight = Number(
        secondary, L"viewportHeight", config.stationhead.secondaryViewportHeight, 480, 4000);
    // Window B is intentionally staggered two minutes after the 50-minute primary reload.
    // Keep this authoritative even when an older cloud cache still contains 57 minutes.
    config.stationhead.secondaryReloadIntervalMinutes = 52;

    const auto mineo = Object(root, L"mineo");
    config.mineo.enabled = Boolean(mineo, L"enabled", config.mineo.enabled);
    config.mineo.url = Text(mineo, L"url", config.mineo.url);
    config.mineo.morningHour = Number(
        mineo, L"morningHour", config.mineo.morningHour, 0, 23);
    config.mineo.nightHour = Number(
        mineo, L"nightHour", config.mineo.nightHour, 0, 23);
    config.mineo.yuzuEnabled = Boolean(
        mineo, L"yuzuEnabled", config.mineo.yuzuEnabled);
    config.mineo.showOnFirstRun = Boolean(
        mineo, L"showOnFirstRun", config.mineo.showOnFirstRun);
    config.mineo.dataSelector = Text(
        mineo, L"dataSelector", config.mineo.dataSelector);
    config.mineo.yuzuSelector = Text(
        mineo, L"yuzuSelector", config.mineo.yuzuSelector);
    config.mineo.yuzuReadyText = Text(
        mineo, L"yuzuReadyText", config.mineo.yuzuReadyText);
    config.mineo.yuzuDeclaredText = Text(
        mineo, L"yuzuDeclaredText", config.mineo.yuzuDeclaredText);

    return true;
  } catch (...) {
    return false;
  }
}
}  // namespace hp
