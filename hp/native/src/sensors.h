#pragma once
#include "common.h"
#include "config.h"
#include "logger.h"

namespace hp {
struct SensorSnapshot {
  bool co2Connected = false;
  int co2 = 0;
  double temperatureCorrected = 0;
  double humidityCorrected = 0;
  int64_t observedAt = 0;
};

class SensorHub {
 public:
  SensorHub(HWND window, AppConfig config, fs::path dataDir, Logger& log);
  ~SensorHub();
  void Start();
  void Stop();
  SensorSnapshot Snapshot() const;
  std::string BuildTelemetryPayload(const std::wstring& deviceId, const std::string& appVersion);
  void ApplyTelemetryReceipt(const std::vector<uint64_t>& acknowledgedSequences,
                             uint64_t nextSequence);

  struct Sample {
    uint64_t sequence = 0;
    int64_t observedAt = 0;
    int co2 = 0;
    double temperature = 0;
    double humidity = 0;
    double temperatureCorrected = 0;
    double humidityCorrected = 0;
  };

 private:
  void SerialLoop();
  bool AppendOutbox(const Sample& sample);
  void LoadOutbox();
  bool RewriteOutboxLocked(const std::deque<Sample>& samples);
  void CompactOutboxLocked();
  std::wstring FindSerialPort();

  HWND window_;
  AppConfig config_;
  fs::path outboxPath_;
  fs::path outboxAckPath_;
  Logger& log_;
  mutable std::mutex mutex_;
  SensorSnapshot state_;
  std::deque<Sample> outbox_;
  uint64_t nextSequence_ = 1;
  uint64_t acknowledgedSequence_ = 0;
  size_t acknowledgedSinceCompaction_ = 0;
  int64_t lastPersistedBucket_ = -1;
  std::atomic<bool> stopping_{false};
  std::thread serialThread_;
  std::condition_variable stopWake_;
  std::mutex stopMutex_;
};
}  // namespace hp
