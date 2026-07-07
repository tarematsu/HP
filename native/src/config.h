#pragma once
#include "common.h"

namespace hp {
// Compile-time defaults; cloud configuration may override supported values.
struct StationheadConfig {
  std::wstring url = L"https://www.stationhead.com/sakuramankai";
  std::wstring fallbackUrl = L"https://www.stationhead.com/buddy46";
  std::wstring sakurazakaUrl = L"https://www.stationhead.com/sakurazaka46jp";
  std::wstring sakurazakaHandle = L"sakurazaka46jp";
  int audioFallbackSeconds = 0;
  int reloadIntervalMinutes = 50;
  int healthCheckIntervalSeconds = 60;
  int restartAfterHealthMisses = 3;
  bool blockImagesAfterPlayback = true;
  bool blockFontsAfterPlayback = true;
  bool hideChatAfterPlayback = true;
  bool lowMemoryMode = true;
  size_t memoryLimitMb = 450;
  int viewportWidth = 1280;
  int viewportHeight = 12000;
  bool secondaryEnabled = true;
  std::wstring secondaryUrl = L"https://www.stationhead.com/buddy46";
  int secondaryStartDelaySeconds = 3;
  int secondaryViewportWidth = 800;
  int secondaryViewportHeight = 1000;
  int secondaryReloadIntervalMinutes = 52;
};

struct MineoConfig {
  bool enabled = true;
  std::wstring url = L"https://my.mineo.jp/";
  int morningHour = 6;
  int morningMinute = 58;
  int nightHour = 22;
  int nightMinute = 58;
  bool yuzuEnabled = true;
  bool showOnFirstRun = false;
  // Optional CSS selectors can be filled after inspecting the live MyPage DOM.
  std::wstring dataSelector;
  std::wstring yuzuSelector = L"input[type='submit'][name*='Devolve']";
  // The declaration-complete text is known. The pre-click selector is stable on the live MyPage.
  std::wstring yuzuReadyText = L"ゆずるね。";
  std::wstring yuzuDeclaredText = L"宣言中";
};

struct AppConfig {
  std::wstring cloudflareBaseUrl = L"https://homepanel-cloud.example.invalid";
  std::wstring deviceId = L"homepanel-device";
  int screenWidth = 1920;
  int screenHeight = 1280;
  int cloudPollSeconds = 300;
  int telemetryMinutes = 30;
  double temperatureOffset = -4.5;
  std::wstring serialPort;
  StationheadConfig stationhead;
  MineoConfig mineo;
};

AppConfig LoadConfig(const fs::path& path);
std::wstring LoadProtectedToken(const fs::path& path, const wchar_t* environmentName);
bool SaveProtectedToken(const fs::path& path, const std::wstring& value);
}  // namespace hp
