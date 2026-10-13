#pragma once
#include "common.h"
#include "config.h"
#include "logger.h"

namespace hp {
struct HttpResponse {
  DWORD status = 0;
  std::vector<uint8_t> body;
  std::wstring etag;
};

struct TelemetryReceipt {
  bool success = false;
  std::vector<uint64_t> acknowledgedSequences;
  uint64_t nextSequence = 0;
};

class CloudClient {
 public:
  using TelemetryCallback = std::function<void(TelemetryReceipt)>;

  CloudClient(HWND window, AppConfig config, fs::path dataDir, std::wstring deviceToken, std::wstring actionToken, Logger& log);
  ~CloudClient();
  void Start();
  void Stop();
  void RefreshNow();
  bool RequestRemoteRefresh();
  std::string FetchUpdateManifest();
  TelemetryReceipt SendTelemetry(const std::string& json);
  void QueueTelemetry(std::string json, TelemetryCallback callback);
  bool AcknowledgeCommand(int64_t id, bool success, const std::wstring& result);
  std::wstring LastSuccessText() const;
  std::wstring WorkerVersion() const;
  int ConsecutiveFailures() const { return failures_.load(); }

 private:
  struct PendingTelemetry {
    uint64_t generation = 0;
    std::string json;
    TelemetryCallback callback;
  };

  HttpResponse Request(const std::wstring& method, const std::wstring& path, const std::wstring& token,
                       const std::wstring& etag = {}, const std::string& body = {}, const wchar_t* contentType = L"application/json");
  std::optional<HttpResponse> TryCompressedExchange(
      const std::wstring& method,
      const std::wstring& path,
      const std::wstring& token);
  void Loop();
  void Synchronize();
  void ApplyPresenceFallback();
  void LoadCacheMetadata();
  void SaveCacheMetadata();
  void EnsureHttpHandlesLocked();
  void ResetHttpHandlesLocked();
  std::vector<uint8_t> LocalizeRadarTiles(const std::vector<uint8_t>& body);

  void StartNetworkChangeWatcher();
  void StopNetworkChangeWatcher();

  HWND window_;
  AppConfig config_;
  fs::path dataDir_;
  std::wstring deviceToken_;
  std::wstring actionToken_;
  Logger& log_;
  std::thread thread_;
  std::thread networkChangeThread_;
  HANDLE networkChangeStopEvent_{};
  std::atomic<bool> started_{false};
  std::atomic<bool> stopping_{false};
  std::atomic<bool> immediate_{false};
  std::condition_variable wake_;
  std::mutex wakeMutex_;
  std::atomic<int> failures_{0};
  mutable std::mutex stateMutex_;

  std::mutex httpMutex_;
  HINTERNET session_ = nullptr;
  HINTERNET connection_ = nullptr;
  std::wstring host_;
  std::wstring basePath_;
  INTERNET_PORT port_ = 0;
  bool secure_ = true;
  DWORD accessType_ = WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY;

  std::mutex pendingTelemetryMutex_;
  std::optional<PendingTelemetry> pendingTelemetry_;
  uint64_t pendingTelemetryGeneration_ = 0;
  std::mutex pendingExchangeMutex_;
  std::wstring pendingExchangeBundlePath_;
  std::vector<uint8_t> pendingExchangeRadar_;

  std::wstring lastSuccess_;
  std::wstring workerVersion_;
  // Owned by the cloud sync thread. Identical repeated failures should not
  // reopen and reparse dashboard.json after the error was already published.
  std::wstring lastPublishedCloudError_;
  int dashboardVersion_ = -1;
  int radarVersion_ = -1;
  int switchbotVersion_ = -1;
  int deviceConfigVersion_ = -1;
  // Synchronize() is confined to the cloud polling thread. A validated
  // device-config.json need not be re-opened and parsed on every poll when
  // its size, modification timestamp and expected version are unchanged.
  struct DeviceConfigValidatedStamp {
    std::uintmax_t size = 0;
    fs::file_time_type modifiedAt{};
    int version = -1;
    bool valid = false;
  } deviceConfigValidatedStamp_;
  // The radar representative PNG is queried on every sync. Recheck its first
  // eight bytes only when its filesystem stamp changes; missing/empty images
  // are never cached as valid, so a completed download recovers immediately.
  struct RadarRepresentativeValidatedStamp {
    std::uintmax_t size = 0;
    fs::file_time_type modifiedAt{};
    bool valid = false;
  } radarRepresentativeValidatedStamp_;
  // Radar payloads may update every few minutes. Full recursive cache
  // cleanup is periodic; tile reads and cache misses remain immediate.
  uint64_t lastRadarCachePruneTick_ = 0;
  bool cacheMetadataDirty_ = false;
  bool presenceFallbackActive_ = false;
};
}  // namespace hp
