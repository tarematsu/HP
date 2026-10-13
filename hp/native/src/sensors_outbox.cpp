#include "sensors.h"
#include <limits>
#include <winrt/Windows.Data.Json.h>

namespace hp {
namespace {
constexpr uint64_t kMaxTelemetrySequence = 9'007'199'254'740'990ULL;
}

bool SensorHub::AppendOutbox(const Sample& sample) {
  std::lock_guard lock(mutex_);
  const std::string line = SampleJson(sample) + "\n";
  HANDLE file = CreateFileW(outboxPath_.c_str(), FILE_APPEND_DATA, FILE_SHARE_READ, nullptr,
                            OPEN_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
  if (file == INVALID_HANDLE_VALUE) return false;
  DWORD written = 0;
  const bool ok = WriteFile(file, line.data(), static_cast<DWORD>(line.size()), &written, nullptr) &&
                  written == line.size();
  CloseHandle(file);
  if (!ok) return false;
  outbox_.push_back(sample);
  return true;
}

void SensorHub::LoadOutbox() {
  std::ifstream ack(outboxAckPath_);
  ack >> acknowledgedSequence_;
  if (acknowledgedSequence_ < std::numeric_limits<uint64_t>::max()) {
    nextSequence_ = std::max(nextSequence_, acknowledgedSequence_ + 1);
  }
  std::ifstream input(outboxPath_);
  std::string line;
  bool repairNeeded = false;
  while (std::getline(input, line)) {
    try {
      const auto object = winrt::Windows::Data::Json::JsonObject::Parse(Utf8ToWide(line));
      Sample sample;
      sample.sequence = static_cast<uint64_t>(object.GetNamedNumber(L"sequence"));
      sample.observedAt = static_cast<int64_t>(object.GetNamedNumber(L"observedAt"));
      sample.co2 = static_cast<int>(object.GetNamedNumber(L"co2"));
      sample.temperature = object.GetNamedNumber(L"temperature");
      sample.humidity = object.GetNamedNumber(L"humidity");
      sample.temperatureCorrected = object.GetNamedNumber(L"temperatureCorrected");
      sample.humidityCorrected = object.GetNamedNumber(L"humidityCorrected");
      if (!SampleValuesValid(sample)) {
        repairNeeded = true;
        continue;
      }
      nextSequence_ = std::max(nextSequence_, sample.sequence + 1);
      lastPersistedBucket_ = std::max(lastPersistedBucket_, sample.observedAt / kTelemetryBucketMs);
      if (sample.sequence > acknowledgedSequence_) outbox_.push_back(sample);
    } catch (...) {
      repairNeeded = true;
    }
  }
  if (repairNeeded) {
    if (RewriteOutboxLocked(outbox_)) log_.Warn(L"Removed invalid CO2 records from telemetry outbox");
    else log_.Warn(L"Failed to repair invalid CO2 telemetry outbox");
  }
}

bool SensorHub::RewriteOutboxLocked(const std::deque<Sample>& samples) {
  // Acknowledgement/rebase may rebuild an entire offline backlog. Append
  // directly so no transient sample string or ostringstream buffer is needed.
  std::string text;
  if (samples.size() <= text.max_size() / 192) {
    text.reserve(samples.size() * 192);
  }
  for (const auto& sample : samples) {
    AppendSampleJson(text, sample);
    text.push_back('\n');
  }
  return AtomicWriteText(outboxPath_, text);
}

std::string SensorHub::BuildTelemetryPayload(const std::wstring& deviceId,
                                             const std::string& appVersion) {
  std::lock_guard lock(mutex_);
  const size_t count = std::min<size_t>(60, outbox_.size());
  const std::string escapedId = EscapeJson(WideToUtf8(deviceId));
  const std::string escapedVersion = EscapeJson(appVersion);
  // Building up to 60 queued samples through ostringstream performs repeated
  // stream formatting and buffer growth while holding the sensor mutex.
  // Preallocate the bounded JSON payload and reuse the shared to_chars
  // integer formatter; no wire-format or telemetry cadence changes.
  std::string body;
  body.reserve(160 + escapedId.size() + escapedVersion.size() + count * 208);
  body += "{\"deviceId\":\"";
  body += escapedId;
  body += "\",\"appVersion\":\"";
  body += escapedVersion;
  body += "\",\"stationheadOk\":false,\"outboxCount\":";
  AppendInteger(body, outbox_.size());
  body += ",\"samples\":[";
  for (size_t i = 0; i < count; ++i) {
    if (i) body.push_back(',');
    AppendSampleJson(body, outbox_[i]);
  }
  body += "]}";
  return body;
}

void SensorHub::ApplyTelemetryReceipt(const std::vector<uint64_t>& acknowledgedSequences,
                                      uint64_t nextSequence) {
  std::lock_guard lock(mutex_);
  uint64_t persistedAck = acknowledgedSequence_;
  if (nextSequence) persistedAck = std::max(persistedAck, nextSequence - 1);
  if (!acknowledgedSequences.empty()) {
    persistedAck = std::max(persistedAck, acknowledgedSequences.back());
  }

  // Telemetry replies can be repeated while the offline outbox is unchanged.
  // Compute the next sequence without copying the deque; only construct a
  // transactional working copy when an acknowledgement removes an entry or a
  // sequence actually requires rebasing.
  uint64_t nextUnchangedSequence =
      persistedAck == std::numeric_limits<uint64_t>::max()
          ? persistedAck : persistedAck + 1;
  bool needsOutboxRewrite = false;
  for (const Sample& sample : outbox_) {
    if (std::binary_search(acknowledgedSequences.begin(),
                           acknowledgedSequences.end(), sample.sequence) ||
        nextUnchangedSequence > kMaxTelemetrySequence ||
        sample.sequence < nextUnchangedSequence) {
      needsOutboxRewrite = true;
      break;
    }
    nextUnchangedSequence = sample.sequence >= kMaxTelemetrySequence
        ? kMaxTelemetrySequence + 1 : sample.sequence + 1;
  }
  if (!needsOutboxRewrite) {
    if (persistedAck > acknowledgedSequence_ &&
        !AtomicWriteText(outboxAckPath_, std::to_string(persistedAck))) {
      log_.Warn(L"Failed to persist the telemetry acknowledgement high-water mark");
    }
    acknowledgedSequence_ = std::max(acknowledgedSequence_, persistedAck);
    nextSequence_ = std::max(nextSequence_, nextUnchangedSequence);
    return;
  }

  std::deque<Sample> updated = outbox_;
  const size_t before = updated.size();
  std::erase_if(updated, [&](const Sample& sample) {
    return std::binary_search(
        acknowledgedSequences.begin(), acknowledgedSequences.end(), sample.sequence);
  });
  const size_t removed = before - updated.size();

  uint64_t candidate = persistedAck == std::numeric_limits<uint64_t>::max()
      ? persistedAck
      : persistedAck + 1;
  size_t rebased = 0;
  for (auto& sample : updated) {
    if (candidate > kMaxTelemetrySequence) {
      log_.Warn(L"Telemetry sequence space is exhausted; preserving the outbox for manual recovery");
      return;
    }
    if (sample.sequence < candidate) {
      sample.sequence = candidate;
      ++rebased;
    }
    if (sample.sequence >= kMaxTelemetrySequence) {
      candidate = kMaxTelemetrySequence + 1;
    } else {
      candidate = sample.sequence + 1;
    }
  }

  if ((removed || rebased) && !RewriteOutboxLocked(updated)) {
    log_.Warn(L"Failed to persist telemetry outbox update; retaining the existing outbox");
    return;
  }
  if (persistedAck > acknowledgedSequence_ &&
      !AtomicWriteText(outboxAckPath_, std::to_string(persistedAck))) {
    log_.Warn(L"Failed to persist the telemetry acknowledgement high-water mark");
  }
  if (removed || rebased) outbox_ = std::move(updated);
  acknowledgedSequence_ = std::max(acknowledgedSequence_, persistedAck);
  nextSequence_ = std::max(nextSequence_, candidate);
  if (rebased) {
    log_.Warn(L"Rebased " + std::to_wstring(rebased) +
              L" telemetry samples above the server sequence high-water mark");
  }
}

}  // namespace hp
