// Device-state synchronization only. Radar localization and dormant
// Stationhead health projection live in dedicated implementation files.
#include "cloud_client_radar_cache.cpp"
#include "cloud_client_stationhead_health.cpp"
#include "cloud_client.h"
#include <limits>
#include <winrt/Windows.Data.Json.h>

namespace hp {
namespace {
std::wstring Utf8BytesToWide(const std::vector<uint8_t>& bytes) {
  if (bytes.empty() ||
      bytes.size() > static_cast<size_t>(std::numeric_limits<int>::max())) {
    return {};
  }
  const char* const input = reinterpret_cast<const char*>(bytes.data());
  const int inputSize = static_cast<int>(bytes.size());
  const int outputSize = MultiByteToWideChar(
      CP_UTF8, MB_ERR_INVALID_CHARS, input, inputSize, nullptr, 0);
  if (outputSize <= 0) return {};
  std::wstring output(static_cast<size_t>(outputSize), L'\0');
  if (MultiByteToWideChar(
          CP_UTF8, MB_ERR_INVALID_CHARS, input, inputSize,
          output.data(), outputSize) != outputSize) {
    return {};
  }
  return output;
}
}  // namespace

void CloudClient::ApplyPresenceFallback() {
  if (presenceFallbackActive_) return;
  JsonObject fallback;
  try {
    std::ifstream input(dataDir_ / L"switchbot.json", std::ios::binary);
    std::string text((std::istreambuf_iterator<char>(input)), {});
    if (!text.empty()) fallback = JsonObject::Parse(Utf8ToWide(text));
  } catch (...) {
    fallback = JsonObject{};
  }
  fallback.SetNamedValue(L"presence", JsonValue::CreateStringValue(L"home"));
  fallback.SetNamedValue(L"fallback", JsonValue::CreateBooleanValue(true));
  fallback.SetNamedValue(
      L"fallbackReason",
      JsonValue::CreateStringValue(L"external-service-unavailable"));
  const std::string text = WideToUtf8(fallback.Stringify().c_str());
  if (!AtomicWriteText(dataDir_ / L"switchbot.json", text)) {
    log_.Warn(L"Failed to write home-presence fallback state");
    return;
  }
  switchbotVersion_ = -1;
  cacheMetadataDirty_ = true;
  presenceFallbackActive_ = true;
  PostMessageW(window_, WM_HP_SWITCHBOT_UPDATED, 0, 0);
  log_.Warn(
      L"External service unavailable; presence forced to home until a fresh "
      L"SwitchBot state is received");
}

void CloudClient::Synchronize() {
  if (config_.cloudflareBaseUrl.empty()) {
    throw std::runtime_error("cloudflareBaseUrl is empty");
  }
  if (deviceToken_.empty()) throw std::runtime_error("device token missing");

  const bool stationheadSyncEnabled = NativeStationheadSyncEnabled();
  const fs::path dashboardPath = dataDir_ / L"dashboard.json";
  const fs::path radarPath = dataDir_ / L"radar.json";
  const fs::path switchbotPath = dataDir_ / L"switchbot.json";
  const fs::path stationheadPath = dataDir_ / L"stationhead.json";
  const fs::path stationheadHealthPath = dataDir_ / L"stationhead-health.json";
  const fs::path deviceConfigPath = dataDir_ / L"device-config.json";
  const auto requestedVersion = [](const fs::path& path, int version) {
    std::error_code error;
    return fs::exists(path, error) ? version : -1;
  };
  const fs::path representativeRadarPath = dataDir_ / L"radar-cache" /
      L"v1" / L"radar" / L"frame" / L"representative" / L"latest.png";
  const auto requestedRadarVersion = [&]() {
    std::error_code error;
    if (!fs::exists(radarPath, error) ||
        !fs::exists(representativeRadarPath, error) ||
        !HasPngSignature(representativeRadarPath)) {
      return -1;
    }
    return radarVersion_;
  };

  std::wstring path = L"/v1/device/sync?deviceId=";
  path.reserve(256);
  path += config_.deviceId;
  path += L"&dashboardVersion=" +
      std::to_wstring(requestedVersion(dashboardPath, dashboardVersion_));
  path += L"&radarVersion=" + std::to_wstring(requestedRadarVersion());
  path += L"&switchbotVersion=" + std::to_wstring(
      presenceFallbackActive_
          ? -1
          : requestedVersion(switchbotPath, switchbotVersion_));
  if (stationheadSyncEnabled) {
    path += L"&stationheadVersion=" +
        std::to_wstring(requestedVersion(stationheadPath, stationheadVersion_));
    path += L"&stationheadHealthVersion=" + std::to_wstring(
        requestedVersion(stationheadHealthPath, stationheadHealthVersion_));
  }
  path += L"&configVersion=" +
      std::to_wstring(requestedVersion(deviceConfigPath, deviceConfigVersion_));

  const auto response = Request(L"GET", path, deviceToken_);
  if (response.status != 200) {
    throw std::runtime_error(
        "device sync HTTP " + std::to_string(response.status));
  }
  const JsonObject root = JsonObject::Parse(Utf8BytesToWide(response.body));
  const JsonObject versions = root.GetNamedObject(L"versions", JsonObject{});

  const int nextDashboard =
      VersionOr(versions, L"dashboard", dashboardVersion_);
  const int nextRadar = VersionOr(versions, L"radar", radarVersion_);
  const int nextSwitchbot =
      VersionOr(versions, L"switchbot", switchbotVersion_);
  const int nextStationhead = stationheadSyncEnabled
      ? VersionOr(versions, L"stationhead", stationheadVersion_)
      : stationheadVersion_;
  const int nextStationheadHealth = stationheadSyncEnabled
      ? VersionOr(
          versions, L"stationheadHealth", stationheadHealthVersion_)
      : stationheadHealthVersion_;
  const int nextConfig = VersionOr(versions, L"config", deviceConfigVersion_);

  bool dashboardApplied = false;
  bool radarApplied = false;
  bool switchbotApplied = false;
  bool stationheadApplied = false;
  bool stationheadHealthApplied = false;
  bool configApplied = false;

  if (auto payload = StringPayload(root, L"dashboard")) {
    if (!AtomicWriteBytes(dashboardPath, *payload)) {
      throw std::runtime_error("dashboard data cache write failed");
    }
    dashboardApplied = true;
    PostMessageW(window_, WM_HP_CLOUD_UPDATED, 0, 0);
  }
  if (auto payload = StringPayload(root, L"radar")) {
    try {
      const auto localized = LocalizeRadarTiles(*payload);
      if (!AtomicWriteBytes(radarPath, localized)) {
        throw std::runtime_error("radar cache write failed");
      }
      radarApplied = true;
      PostMessageW(window_, WM_HP_RADAR_UPDATED, 0, 0);
    } catch (const std::exception& error) {
      log_.Warn(
          L"Radar payload withheld until representative PNG is available: " +
          Utf8ToWide(error.what()));
    } catch (...) {
      log_.Warn(L"Radar payload withheld until representative PNG is available");
    }
  }
  if (auto payload = StringPayload(root, L"switchbot")) {
    if (!AtomicWriteBytes(switchbotPath, *payload)) {
      throw std::runtime_error("SwitchBot cache write failed");
    }
    switchbotApplied = true;
    presenceFallbackActive_ = false;
    PostMessageW(window_, WM_HP_SWITCHBOT_UPDATED, 0, 0);
  }
  if (stationheadSyncEnabled) {
    if (auto payload = StringPayload(root, L"stationhead")) {
      if (!AtomicWriteBytes(stationheadPath, *payload)) {
        throw std::runtime_error("Stationhead cache write failed");
      }
      stationheadApplied = true;
      PostMessageW(window_, WM_HP_STATIONHEAD_CHANGED, 0, 0);
    }
    if (auto payload = StringPayload(root, L"stationheadHealth")) {
      if (!AtomicWriteBytes(stationheadHealthPath, *payload)) {
        throw std::runtime_error("Stationhead health cache write failed");
      }
      stationheadHealthApplied = true;
    }
  }
  if (auto payload = StringPayload(root, L"deviceConfig")) {
    if (!AtomicWriteBytes(deviceConfigPath, *payload)) {
      throw std::runtime_error("device config cache write failed");
    }
    configApplied = true;
    PostMessageW(window_, WM_HP_CONFIG_UPDATED, 0, 0);
  }

  if (root.HasKey(L"commands") &&
      root.GetNamedValue(L"commands").ValueType() == JsonValueType::Array) {
    const JsonArray commands = root.GetNamedArray(L"commands");
    if (commands.Size() > 0) {
      JsonObject envelope;
      envelope.SetNamedValue(
          L"deviceId", JsonValue::CreateStringValue(config_.deviceId));
      envelope.SetNamedValue(L"commands", commands);
      const std::string text = WideToUtf8(envelope.Stringify().c_str());
      if (!AtomicWriteText(dataDir_ / L"commands.json", text)) {
        throw std::runtime_error("device command cache write failed");
      }
      PostMessageW(window_, WM_HP_COMMANDS_UPDATED, 0, 0);
    }
  }

  const auto acceptedVersion =
      [this](const wchar_t* name, int current, int next, bool payloadApplied) {
        if (next == current || payloadApplied) return next;
        log_.Warn(
            std::wstring(L"Cloud sync withheld ") + name + L" version " +
            std::to_wstring(next) + L" because its payload was absent");
        return current;
      };
  const int acceptedDashboard = acceptedVersion(
      L"dashboard", dashboardVersion_, nextDashboard, dashboardApplied);
  const int acceptedRadar =
      acceptedVersion(L"radar", radarVersion_, nextRadar, radarApplied);
  const int acceptedSwitchbot = acceptedVersion(
      L"switchbot", switchbotVersion_, nextSwitchbot, switchbotApplied);
  const int acceptedStationhead = stationheadSyncEnabled
      ? acceptedVersion(
          L"stationhead", stationheadVersion_, nextStationhead,
          stationheadApplied)
      : stationheadVersion_;
  const int acceptedStationheadHealth = stationheadSyncEnabled
      ? acceptedVersion(
          L"stationhead health", stationheadHealthVersion_,
          nextStationheadHealth, stationheadHealthApplied)
      : stationheadHealthVersion_;
  const int acceptedConfig = acceptedVersion(
      L"device config", deviceConfigVersion_, nextConfig, configApplied);

  if (dashboardVersion_ != acceptedDashboard ||
      radarVersion_ != acceptedRadar ||
      switchbotVersion_ != acceptedSwitchbot ||
      stationheadVersion_ != acceptedStationhead ||
      stationheadHealthVersion_ != acceptedStationheadHealth ||
      deviceConfigVersion_ != acceptedConfig) {
    dashboardVersion_ = acceptedDashboard;
    radarVersion_ = acceptedRadar;
    switchbotVersion_ = acceptedSwitchbot;
    stationheadVersion_ = acceptedStationhead;
    stationheadHealthVersion_ = acceptedStationheadHealth;
    deviceConfigVersion_ = acceptedConfig;
    cacheMetadataDirty_ = true;
  }
  if (cacheMetadataDirty_) SaveCacheMetadata();

  if (stationheadSyncEnabled) {
    std::wstring nextHealthText;
    try {
      std::ifstream input(stationheadHealthPath, std::ios::binary);
      std::string text((std::istreambuf_iterator<char>(input)), {});
      nextHealthText = text.empty()
          ? L"Stationhead収集: 確認中"
          : StationheadHealthSummary(JsonObject::Parse(Utf8ToWide(text)));
    } catch (const std::exception& error) {
      log_.Warn(
          L"Stationhead health read failed without interrupting dashboard sync: " +
          Utf8ToWide(error.what()));
      nextHealthText = L"Stationhead収集: 状態取得失敗";
    } catch (...) {
      log_.Warn(
          L"Stationhead health read failed without interrupting dashboard sync");
      nextHealthText = L"Stationhead収集: 状態取得失敗";
    }
    UpdateStationheadHealthText(std::move(nextHealthText));
  }

  {
    std::lock_guard lock(stateMutex_);
    lastSuccess_ = IsoLocalNow();
    workerVersion_ = root.GetNamedString(L"workerVersion", L"").c_str();
  }
  failures_ = 0;
}

}  // namespace hp
