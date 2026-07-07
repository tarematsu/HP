#include "sensors.h"
#include <cmath>

namespace hp {
namespace {
constexpr auto kCommandTimeout = std::chrono::seconds(10);
constexpr auto kSampleTimeout = std::chrono::seconds(10);
constexpr size_t kCompactAfterAck = 288;
constexpr uintmax_t kCompactBytes = 1024 * 1024;
constexpr int64_t kEarliestSampleTime = 946'684'800'000;
constexpr int64_t kTelemetryBucketMs = 5 * 60'000;

bool MeasurementValuesValid(int co2, double humidity, double temperature) {
  return co2 >= 250 && co2 <= 10'000 &&
         std::isfinite(humidity) && humidity >= 0.0 && humidity <= 100.0 &&
         std::isfinite(temperature) && temperature >= -40.0 && temperature <= 85.0;
}

bool SampleValuesValid(const SensorHub::Sample& sample) {
  return sample.sequence > 0 && sample.observedAt >= kEarliestSampleTime &&
         MeasurementValuesValid(sample.co2, sample.humidity, sample.temperature) &&
         std::isfinite(sample.temperatureCorrected) &&
         sample.temperatureCorrected >= -80.0 && sample.temperatureCorrected <= 120.0 &&
         std::isfinite(sample.humidityCorrected) &&
         sample.humidityCorrected >= 0.0 && sample.humidityCorrected <= 100.0;
}

enum class LineResult { Line, Timeout, Error, Stopped };

std::string EscapeJson(const std::string& value) {
  std::string out;
  for (char c : value) {
    if (c == '"' || c == '\\') { out.push_back('\\'); out.push_back(c); }
    else if (c == '\n') out += "\\n";
    else if (static_cast<unsigned char>(c) >= 0x20) out.push_back(c);
  }
  return out;
}

std::string SampleJson(const SensorHub::Sample& s) {
  std::ostringstream out;
  out << std::fixed << std::setprecision(2)
      << "{\"sequence\":" << s.sequence << ",\"observedAt\":" << s.observedAt
      << ",\"co2\":" << s.co2 << ",\"temperature\":" << s.temperature
      << ",\"humidity\":" << s.humidity << ",\"temperatureCorrected\":" << s.temperatureCorrected
      << ",\"humidityCorrected\":" << s.humidityCorrected << '}';
  return out.str();
}

bool ConfigurePort(HANDLE serial) {
  DCB dcb{};
  dcb.DCBlength = sizeof(dcb);
  if (!GetCommState(serial, &dcb)) return false;
  dcb.BaudRate = CBR_115200;
  dcb.ByteSize = 8;
  dcb.Parity = NOPARITY;
  dcb.StopBits = ONESTOPBIT;
  dcb.fBinary = TRUE;
  dcb.fParity = FALSE;
  dcb.fOutxCtsFlow = FALSE;
  dcb.fOutxDsrFlow = FALSE;
  dcb.fDtrControl = DTR_CONTROL_ENABLE;
  dcb.fDsrSensitivity = FALSE;
  dcb.fTXContinueOnXoff = TRUE;
  dcb.fOutX = FALSE;
  dcb.fInX = FALSE;
  dcb.fErrorChar = FALSE;
  dcb.fNull = FALSE;
  dcb.fRtsControl = RTS_CONTROL_ENABLE;
  dcb.fAbortOnError = FALSE;
  if (!SetCommState(serial, &dcb)) return false;

  COMMTIMEOUTS timeouts{};
  timeouts.ReadIntervalTimeout = MAXDWORD;
  timeouts.ReadTotalTimeoutMultiplier = 0;
  timeouts.ReadTotalTimeoutConstant = 1000;
  timeouts.WriteTotalTimeoutMultiplier = 0;
  timeouts.WriteTotalTimeoutConstant = 1000;
  if (!SetCommTimeouts(serial, &timeouts)) return false;
  SetupComm(serial, 4096, 4096);
  return PurgeComm(serial, PURGE_RXABORT | PURGE_RXCLEAR | PURGE_TXABORT | PURGE_TXCLEAR) != FALSE;
}

LineResult ReadLine(HANDLE serial, std::string& buffer, std::string& line,
                    const std::atomic<bool>& stopping, std::chrono::steady_clock::duration timeout) {
  const auto deadline = std::chrono::steady_clock::now() + timeout;
  while (!stopping.load()) {
    const size_t newline = buffer.find('\n');
    if (newline != std::string::npos) {
      line = buffer.substr(0, newline);
      buffer.erase(0, newline + 1);
      if (!line.empty() && line.back() == '\r') line.pop_back();
      return LineResult::Line;
    }
    if (std::chrono::steady_clock::now() >= deadline) return LineResult::Timeout;
    char chunk[256]{};
    DWORD read = 0;
    if (!ReadFile(serial, chunk, sizeof(chunk), &read, nullptr)) return LineResult::Error;
    if (read) {
      buffer.append(chunk, read);
      if (buffer.size() > 16 * 1024) return LineResult::Error;
    }
  }
  return LineResult::Stopped;
}

bool WriteCommand(HANDLE serial, const char* command) {
  const std::string payload = std::string(command) + "\r\n";
  DWORD written = 0;
  return WriteFile(serial, payload.data(), static_cast<DWORD>(payload.size()), &written, nullptr) && written == payload.size();
}

bool PrepareSensor(HANDLE serial, std::string& buffer, const std::atomic<bool>& stopping, Logger& log) {
  for (const char* command : {"STP", "ID?", "STA"}) {
    if (!WriteCommand(serial, command)) return false;
    Sleep(100);
    const auto deadline = std::chrono::steady_clock::now() + kCommandTimeout;
    for (;;) {
      const auto now = std::chrono::steady_clock::now();
      if (now >= deadline) {
        log.Warn(L"UD-CO2S command timeout: " + Utf8ToWide(command));
        return false;
      }
      std::string line;
      const LineResult result = ReadLine(serial, buffer, line, stopping, deadline - now);
      if (result != LineResult::Line) {
        log.Warn(L"UD-CO2S command timeout/read failure: " + Utf8ToWide(command));
        return false;
      }
      if (line.rfind("OK", 0) == 0) break;
      if (line.rfind("NG", 0) == 0) {
        log.Warn(L"UD-CO2S rejected command: " + Utf8ToWide(command));
        return false;
      }
    }
  }
  return true;
}


}  // namespace

SensorHub::SensorHub(HWND window, AppConfig config, fs::path dataDir, Logger& log)
    : window_(window), config_(std::move(config)), switchbotPath_(dataDir / L"switchbot.json"),
      outboxPath_(dataDir / L"outbox.ndjson"), outboxAckPath_(std::move(dataDir) / L"outbox.ack"), log_(log) {
  LoadOutbox();
  nextSequence_ = std::max(nextSequence_, static_cast<uint64_t>(std::max<int64_t>(1, UnixMillis())));
}

SensorHub::~SensorHub() { Stop(); }

void SensorHub::Start() {
  stopping_ = false;
  ApplyCloudSwitchBot(switchbotPath_);
  serialThread_ = std::thread([this] { SerialLoop(); });
  log_.Info(L"SwitchBot input uses Cloudflare/OpenAPI; native BLE watcher is disabled");
}

void SensorHub::Stop() {
  stopping_ = true;
  stopWake_.notify_all();
  if (serialThread_.joinable()) serialThread_.join();
}

SensorSnapshot SensorHub::Snapshot() const {
  std::lock_guard lock(mutex_);
  return state_;
}

void SensorHub::ApplyCloudSwitchBot(const fs::path& path) {
  try {
    std::ifstream input(path, std::ios::binary);
    std::string text((std::istreambuf_iterator<char>(input)), {});
    if (text.empty()) return;
    const auto object = winrt::Windows::Data::Json::JsonObject::Parse(Utf8ToWide(text));
    const std::wstring presence = object.GetNamedString(L"presence", L"unknown").c_str();
    const std::wstring brightness = object.GetNamedString(L"brightness", L"unknown").c_str();
    {
      std::lock_guard lock(mutex_);
      state_.doorOpen = object.GetNamedBoolean(L"doorOpen", false);
      state_.motion = object.GetNamedBoolean(L"motion", false);
      if (brightness == L"bright") state_.light = true;
      else if (brightness == L"dim") state_.light = false;
      state_.presence = presence == L"home" ? PresenceState::Home :
                        presence == L"away" ? PresenceState::Away : PresenceState::Unknown;
    }
  } catch (const std::exception& error) {
    log_.Warn(L"SwitchBot cloud state error: " + Utf8ToWide(error.what()));
  } catch (...) {
    log_.Warn(L"SwitchBot cloud state parse failed");
  }
}

std::wstring SensorHub::FindSerialPort() {
  if (!config_.serialPort.empty()) return config_.serialPort;
  HDEVINFO devices = SetupDiGetClassDevsW(&GUID_DEVCLASS_PORTS, nullptr, nullptr, DIGCF_PRESENT);
  if (devices == INVALID_HANDLE_VALUE) return {};
  SP_DEVINFO_DATA info{sizeof(info)};
  std::wstring result;
  std::vector<std::wstring> usb;
  for (DWORD index = 0; SetupDiEnumDeviceInfo(devices, index, &info); ++index) {
    wchar_t friendly[512]{};
    if (!SetupDiGetDeviceRegistryPropertyW(devices, &info, SPDRP_FRIENDLYNAME, nullptr,
                                           reinterpret_cast<PBYTE>(friendly), sizeof(friendly), nullptr)) continue;
    std::wstring name = friendly;
    const auto open = name.rfind(L"(COM");
    const auto close = name.rfind(L')');
    if (open == std::wstring::npos || close <= open) continue;
    const std::wstring port = name.substr(open + 1, close - open - 1);
    std::transform(name.begin(), name.end(), name.begin(), towlower);
    if (name.find(L"ud-co2s") != std::wstring::npos || name.find(L"co2") != std::wstring::npos) {
      result = port;
      break;
    }
    if (name.find(L"usb") != std::wstring::npos) usb.push_back(port);
  }
  SetupDiDestroyDeviceInfoList(devices);
  if (result.empty() && usb.size() == 1) result = usb.front();
  return result;
}

void SensorHub::SerialLoop() {
  winrt::init_apartment(winrt::apartment_type::multi_threaded);
  while (!stopping_) {
    const std::wstring port = FindSerialPort();
    if (port.empty()) {
      bool changed = false;
      {
        std::lock_guard lock(mutex_);
        changed = state_.co2Connected || state_.lastError != L"UD-CO2S not found";
        state_.co2Connected = false;
        state_.lastError = L"UD-CO2S not found";
      }
      if (changed) PostMessageW(window_, WM_HP_SENSOR_UPDATED, 0, 0);
      std::unique_lock lock(stopMutex_);
      stopWake_.wait_for(lock, std::chrono::seconds(10), [this] { return stopping_.load(); });
      continue;
    }

    const std::wstring serialPath = port.rfind(L"\\\\.\\", 0) == 0 ? port : L"\\\\.\\" + port;
    HANDLE serial = CreateFileW(serialPath.c_str(), GENERIC_READ | GENERIC_WRITE, 0, nullptr,
                                OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (serial == INVALID_HANDLE_VALUE) {
      {
        std::lock_guard lock(mutex_);
        state_.co2Connected = false;
        state_.lastError = L"UD-CO2S port open failed";
      }
      PostMessageW(window_, WM_HP_SENSOR_UPDATED, 0, 0);
      std::unique_lock lock(stopMutex_);
      stopWake_.wait_for(lock, std::chrono::seconds(10), [this] { return stopping_.load(); });
      continue;
    }

    std::string buffer;
    if (!ConfigurePort(serial) || !PrepareSensor(serial, buffer, stopping_, log_)) {
      CloseHandle(serial);
      {
        std::lock_guard lock(mutex_);
        state_.co2Connected = false;
        state_.lastError = L"UD-CO2S initialization failed";
      }
      PostMessageW(window_, WM_HP_SENSOR_UPDATED, 0, 0);
      std::unique_lock lock(stopMutex_);
      stopWake_.wait_for(lock, std::chrono::seconds(10), [this] { return stopping_.load(); });
      continue;
    }

    {
      std::lock_guard lock(mutex_);
      state_.co2Connected = false;
      state_.lastError = L"UD-CO2S waiting for data";
    }
    PostMessageW(window_, WM_HP_SENSOR_UPDATED, 0, 0);

    auto validSampleDeadline = std::chrono::steady_clock::now() + kSampleTimeout;
    while (!stopping_) {
      const auto now = std::chrono::steady_clock::now();
      if (now >= validSampleDeadline) {
        log_.Warn(L"UD-CO2S produced no valid measurement for 10 seconds");
        break;
      }

      std::string line;
      const LineResult result = ReadLine(serial, buffer, line, stopping_, validSampleDeadline - now);
      if (result != LineResult::Line) {
        if (result == LineResult::Timeout) log_.Warn(L"UD-CO2S measurement timeout");
        else if (result == LineResult::Error) log_.Warn(L"UD-CO2S measurement read failed");
        break;
      }

      int co2 = 0;
      double humidity = 0, temperature = 0;
      if (sscanf_s(line.c_str(), "CO2=%d,HUM=%lf,TMP=%lf", &co2, &humidity, &temperature) != 3 ||
          !MeasurementValuesValid(co2, humidity, temperature)) continue;

      Sample sample;
      sample.observedAt = UnixMillis();
      sample.sequence = std::max(nextSequence_, static_cast<uint64_t>(sample.observedAt));
      nextSequence_ = sample.sequence + 1;
      sample.co2 = co2;
      sample.humidity = humidity;
      sample.temperature = temperature;
      sample.temperatureCorrected = temperature + config_.temperatureOffset;
      const double absolute = 216.7 * (humidity / 100.0 * 6.112 *
          std::exp((17.62 * temperature) / (243.12 + temperature))) / (273.15 + temperature);
      sample.humidityCorrected = std::clamp(
          absolute * (273.15 + sample.temperatureCorrected) /
          (216.7 * 6.112 * std::exp((17.62 * sample.temperatureCorrected) /
          (243.12 + sample.temperatureCorrected))) * 100.0, 0.0, 100.0);
      if (!SampleValuesValid(sample)) continue;
      validSampleDeadline = std::chrono::steady_clock::now() + kSampleTimeout;

      bool visibleChanged = false;
      {
        std::lock_guard lock(mutex_);
        visibleChanged = !state_.co2Connected || state_.co2 != sample.co2 ||
          std::lround(state_.temperatureCorrected * 10) != std::lround(sample.temperatureCorrected * 10) ||
          std::lround(state_.humidityCorrected) != std::lround(sample.humidityCorrected) ||
          !state_.lastError.empty();
        state_.co2Connected = true;
        state_.co2 = sample.co2;
        state_.temperatureRaw = temperature;
        state_.humidityRaw = humidity;
        state_.temperatureCorrected = sample.temperatureCorrected;
        state_.humidityCorrected = sample.humidityCorrected;
        state_.observedAt = sample.observedAt;
        state_.lastError.clear();
      }
      const int64_t bucket = sample.observedAt / kTelemetryBucketMs;
      if (bucket != lastPersistedBucket_ && AppendOutbox(sample)) lastPersistedBucket_ = bucket;
      if (visibleChanged) PostMessageW(window_, WM_HP_SENSOR_UPDATED, 0, 0);
    }

    WriteCommand(serial, "STP");
    CloseHandle(serial);
    {
      std::lock_guard lock(mutex_);
      state_.co2Connected = false;
      state_.lastError = L"UD-CO2S disconnected";
    }
    PostMessageW(window_, WM_HP_SENSOR_UPDATED, 0, 0);
    if (!stopping_) {
      std::unique_lock lock(stopMutex_);
      stopWake_.wait_for(lock, std::chrono::seconds(5), [this] { return stopping_.load(); });
    }
  }
}

bool SensorHub::AppendOutbox(const Sample& sample) {
  if (!SampleValuesValid(sample)) return false;
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
  state_.outboxCount = outbox_.size();
  return true;
}

void SensorHub::LoadOutbox() {
  std::ifstream ack(outboxAckPath_);
  ack >> acknowledgedSequence_;
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
  state_.outboxCount = outbox_.size();
  if (repairNeeded) {
    if (RewriteOutboxLocked(outbox_)) log_.Warn(L"Removed invalid CO2 records from telemetry outbox");
    else log_.Warn(L"Failed to repair invalid CO2 telemetry outbox");
  }
}

bool SensorHub::RewriteOutboxLocked(const std::deque<Sample>& samples) {
  std::ostringstream text;
  for (const auto& sample : samples) text << SampleJson(sample) << '\n';
  return AtomicWriteText(outboxPath_, text.str());
}

bool SensorHub::WriteAcknowledgedSequenceLocked(uint64_t sequence) {
  return AtomicWriteText(outboxAckPath_, std::to_string(sequence));
}

void SensorHub::CompactOutboxLocked() {
  std::error_code error;
  const uintmax_t bytes = fs::exists(outboxPath_, error) ? fs::file_size(outboxPath_, error) : 0;
  if (acknowledgedSinceCompaction_ < kCompactAfterAck && bytes < kCompactBytes) return;
  if (RewriteOutboxLocked(outbox_)) acknowledgedSinceCompaction_ = 0;
}

std::string SensorHub::BuildTelemetryPayload(const std::wstring& deviceId, const std::string& appVersion,
                                             bool stationheadOk, size_t maxSamples) {
  std::lock_guard lock(mutex_);
  std::ostringstream out;
  out << "{\"deviceId\":\"" << EscapeJson(WideToUtf8(deviceId)) << "\",\"appVersion\":\""
      << EscapeJson(appVersion) << "\",\"stationheadOk\":" << (stationheadOk ? "true" : "false")
      << ",\"outboxCount\":" << outbox_.size() << ",\"samples\":[";
  const size_t count = std::min(maxSamples, outbox_.size());
  for (size_t i = 0; i < count; ++i) {
    if (i) out << ',';
    out << SampleJson(outbox_[i]);
  }
  out << "]}";
  return out.str();
}

void SensorHub::AcknowledgeTelemetry(size_t count) {
  std::lock_guard lock(mutex_);
  count = std::min(count, outbox_.size());
  if (!count) return;
  const uint64_t sequence = outbox_[count - 1].sequence;
  if (!WriteAcknowledgedSequenceLocked(sequence)) return;
  for (size_t i = 0; i < count; ++i) outbox_.pop_front();
  acknowledgedSequence_ = std::max(acknowledgedSequence_, sequence);
  acknowledgedSinceCompaction_ += count;
  state_.outboxCount = outbox_.size();
  CompactOutboxLocked();
}
}  // namespace hp
