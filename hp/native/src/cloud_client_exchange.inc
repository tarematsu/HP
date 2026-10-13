#include "stationhead_leaderboard_capture_spool.h"
#include "stationhead_leaderboard_diagnostics.h"

namespace hp {
namespace {
// Decode the already-sliced binary exchange JSON directly. Constructing a
// temporary std::string from translated.body copies the full JSON response on
// every normal cloud poll before WinRT parses it.
std::wstring ExchangeJsonUtf8ToWide(
    const uint8_t* data, size_t length) {
  if (!data || length == 0 ||
      length > static_cast<size_t>(std::numeric_limits<int>::max())) {
    throw std::runtime_error("device exchange JSON length invalid");
  }
  const int bytes = static_cast<int>(length);
  const char* utf8 = reinterpret_cast<const char*>(data);
  const int wideLength = MultiByteToWideChar(
      CP_UTF8, MB_ERR_INVALID_CHARS, utf8, bytes, nullptr, 0);
  if (wideLength <= 0) {
    throw std::runtime_error("device exchange JSON invalid UTF-8");
  }
  std::wstring output(static_cast<size_t>(wideLength), L'\0');
  if (MultiByteToWideChar(
          CP_UTF8, MB_ERR_INVALID_CHARS, utf8, bytes,
          output.data(), wideLength) != wideLength) {
    throw std::runtime_error("device exchange JSON transcoding failed");
  }
  return output;
}
}  // namespace

void CloudClient::QueueTelemetry(std::string json, TelemetryCallback callback) {
  if (json.empty()) return;
  std::lock_guard lock(pendingTelemetryMutex_);
  pendingTelemetry_ = std::make_shared<PendingTelemetry>(
      PendingTelemetry{
          ++pendingTelemetryGeneration_, std::move(json), std::move(callback)});
}

std::optional<HttpResponse> CloudClient::TryCompressedExchange(
    const std::wstring& method,
    const std::wstring& path,
    const std::wstring& token) {
  if (method == L"GET" && path.starts_with(L"/v1/radar/bundle/")) {
    std::lock_guard lock(pendingExchangeMutex_);
    const std::wstring requested = path.substr(0, path.find_first_of(L"?#"));
    if (!pendingExchangeRadar_.empty() && requested == pendingExchangeBundlePath_) {
      HttpResponse response;
      response.status = 200;
      response.body = std::move(pendingExchangeRadar_);
      pendingExchangeBundlePath_.clear();
      return response;
    }
    return std::nullopt;
  }
  if (method != L"GET" || !path.starts_with(L"/v1/device/sync?")) {
    return std::nullopt;
  }

  const auto number = [&](const wchar_t* name) {
    const std::wstring value = ExchangeQueryValue(path, name);
    return value.empty() ? std::string("-1") : WideToUtf8(value);
  };
  const std::wstring deviceId = ExchangeQueryValue(path, L"deviceId");
  std::string body = "{\"versions\":{";
  // The exchange runs at every cloud sync. Reserve for the fixed envelope and
  // append directly; repeatedly concatenating literals and JSON values
  // allocates temporary strings before appending to the request buffer.
  body.reserve(512);
  body += "\"dashboard\":";
  body += number(L"dashboardVersion");
  body += ",\"radar\":";
  body += number(L"radarVersion");
  body += ",\"switchbot\":";
  body += number(L"switchbotVersion");
  body += ",\"config\":";
  body += number(L"configVersion");
  body.push_back('}');

  std::shared_ptr<PendingTelemetry> telemetry;
  {
    std::lock_guard lock(pendingTelemetryMutex_);
    // Hold one stable generation while HTTP is in flight; copying the shared
    // pointer is constant-time even for a 60-sample telemetry JSON payload.
    telemetry = pendingTelemetry_;
  }
  if (telemetry && !telemetry->json.empty()) {
    body.reserve(body.size() + telemetry->json.size() + 512);
    body += ",\"telemetry\":";
    body += telemetry->json;
  }

  // Keep the established Cloud field names for wire compatibility, but source
  // them exclusively from the rebuilt dedicated-WebView capture spool.
  const auto leaderboardSnapshot =
      stationhead_leaderboard_capture_spool::ReadBatchWithCount();
  const auto& leaderboardCapture = leaderboardSnapshot.batch;
  if (!leaderboardCapture.empty()) {
    body += ",\"leaderboardProbe\":[";
    for (size_t index = 0; index < leaderboardCapture.size(); ++index) {
      if (index != 0) body.push_back(',');
      body += leaderboardCapture[index];
    }
    body.push_back(']');
  }

  const size_t leaderboardSpoolRecords = leaderboardSnapshot.totalRecords;
  const auto leaderboardDiagnostics = stationhead_leaderboard_diagnostics::Read();
  body += ",\"leaderboardProbeStatus\":{\"spoolRecords\":";
  body += std::to_string(leaderboardSpoolRecords);
  body += ",\"batchRecords\":";
  body += std::to_string(leaderboardCapture.size());
  body += ",\"diagnosticSchema\":";
  body += std::to_string(leaderboardDiagnostics.schema);
  body += ",\"collectorStage\":\"";
  body += leaderboardDiagnostics.stage;
  body.push_back('"');
  body += ",\"lastSuccessStage\":\"";
  body += leaderboardDiagnostics.lastSuccessStage;
  body.push_back('"');
  body += ",\"collectorStarted\":";
  body += leaderboardDiagnostics.started ? "true" : "false";
  body += ",\"collectorTicked\":";
  body += leaderboardDiagnostics.ticked ? "true" : "false";
  body += ",\"lastTransitionAt\":";
  body += std::to_string(leaderboardDiagnostics.lastTransitionAt);
  body += ",\"lastFailureAt\":";
  body += std::to_string(leaderboardDiagnostics.lastFailureAt);
  body += ",\"lastError\":\"";
  body += leaderboardDiagnostics.lastError;
  body.push_back('"');
  body += ",\"exchangeAt\":";
  body += std::to_string(UnixMillis());
  body += "}";
  body.push_back('}');

  const HttpResponse exchange = Request(
      L"POST", L"/v1/device/exchange?deviceId=" + deviceId,
      token, {}, body, L"application/json");
  if (exchange.status == 404 || exchange.status == 405) return std::nullopt;
  if (exchange.status != 200) return exchange;
  if (exchange.body.size() < 12 || std::memcmp(exchange.body.data(), "HPEX0001", 8) != 0) {
    throw std::runtime_error("device exchange header invalid");
  }
  const uint32_t jsonLength = ExchangeReadUint32(exchange.body, 8);
  const size_t jsonEnd = 12 + static_cast<size_t>(jsonLength);
  if (jsonLength == 0 || jsonEnd > exchange.body.size()) {
    throw std::runtime_error("device exchange JSON length invalid");
  }

  HttpResponse translated;
  translated.status = 200;
  translated.body.assign(exchange.body.begin() + 12, exchange.body.begin() + jsonEnd);
  const JsonObject root = JsonObject::Parse(
      ExchangeJsonUtf8ToWide(translated.body.data(), translated.body.size()));

  std::wstring bundlePath;
  if (root.HasKey(L"radar") && root.GetNamedValue(L"radar").ValueType() == JsonValueType::String) {
    try {
      const JsonObject radar = JsonObject::Parse(root.GetNamedString(L"radar"));
      bundlePath = radar.GetNamedString(L"bundleUrl", L"").c_str();
      const size_t separator = bundlePath.find_first_of(L"?#");
      if (separator != std::wstring::npos) bundlePath.resize(separator);
    } catch (...) {
      bundlePath.clear();
    }
  }
  {
    std::lock_guard lock(pendingExchangeMutex_);
    pendingExchangeBundlePath_ = std::move(bundlePath);
    pendingExchangeRadar_.assign(exchange.body.begin() + jsonEnd, exchange.body.end());
    if (pendingExchangeBundlePath_.empty()) pendingExchangeRadar_.clear();
  }

  if (telemetry && root.HasKey(L"telemetry") &&
      root.GetNamedValue(L"telemetry").ValueType() == JsonValueType::Object) {
    TelemetryReceipt receipt = ParseExchangeTelemetryReceipt(root.GetNamedObject(L"telemetry"));
    if (receipt.success) {
      TelemetryCallback callback;
      {
        std::lock_guard lock(pendingTelemetryMutex_);
        if (pendingTelemetry_ && pendingTelemetry_->generation == telemetry->generation) {
          callback = std::move(pendingTelemetry_->callback);
          pendingTelemetry_.reset();
        }
      }
      if (callback) callback(std::move(receipt));
    }
  }

  if (!leaderboardCapture.empty() && root.HasKey(L"leaderboardProbe") &&
      root.GetNamedValue(L"leaderboardProbe").ValueType() == JsonValueType::Object) {
    try {
      const JsonObject receipt = root.GetNamedObject(L"leaderboardProbe");
      const bool reported = receipt.GetNamedBoolean(L"reported", false);
      const double acceptedValue = receipt.GetNamedNumber(L"accepted", 0);
      size_t accepted = 0;
      if (acceptedValue > 0 && std::isfinite(acceptedValue) &&
          std::trunc(acceptedValue) == acceptedValue &&
          acceptedValue <= static_cast<double>(leaderboardCapture.size())) {
        accepted = static_cast<size_t>(acceptedValue);
      }
      if (reported && accepted > 0) {
        stationhead_leaderboard_capture_spool::Acknowledge(leaderboardCapture, accepted);
      }
    } catch (...) {
      // Keep the capture spool for the next exchange if acknowledgement is malformed.
    }
  }
  return translated;
}

}  // namespace hp
