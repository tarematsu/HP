#pragma once
#include "common.h"

namespace hp {

struct StationheadConfig {
  // Canonical sakuramankai destination retained even when startup preflight
  // chooses buddy46 for the first WebView navigation.
  std::wstring primaryUrl = L"https://www.stationhead.com/sakuramankai";
  std::wstring url = L"https://www.stationhead.com/sakuramankai";
  // buddy46 is a dedicated rotation source, not an automatic fallback.
  std::wstring alternateUrl = L"https://www.stationhead.com/buddy46";
  std::wstring fallbackUrl;
  int channelId = 318;
  bool blockImages = true;
  bool blockFonts = true;
  bool lowMemoryMode = true;
  bool secondaryEnabled = true;
  std::wstring secondaryUrl = L"https://www.stationhead.com/sakuramankai";
};

struct AppConfig {
  std::wstring cloudflareBaseUrl = L"https://homepanel-cloud.example.invalid";
  std::wstring deviceId = L"homepanel-device";
  int screenWidth = 1920;
  int screenHeight = 1280;
  int cloudPollSeconds = 1800;
  int telemetryMinutes = 240;
  double temperatureOffset = -4.5;
  std::wstring serialPort;
  StationheadConfig stationhead;
};

AppConfig LoadConfig(const fs::path& path);
std::wstring LoadProtectedToken(const fs::path& path, const wchar_t* environmentName);
bool SaveProtectedToken(const fs::path& path, const std::wstring& value);
}  // namespace hp
