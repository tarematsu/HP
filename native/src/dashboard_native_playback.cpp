#include "web_renderer.h"
#include "artwork_cache.h"
#include "json_helpers.h"
#include "winhttp_helpers.h"
#include <winrt/Windows.Data.Json.h>

namespace hp {
namespace {
constexpr int64_t kNativePlaybackPollMs = 10 * 60'000;
constexpr size_t kMaxPlaybackResponseBytes = 4 * 1024 * 1024;
constexpr int64_t kPlaybackTransitionHoldMs = 1'000;
using winrt::Windows::Data::Json::JsonArray;
using winrt::Windows::Data::Json::JsonObject;
using winrt::Windows::Data::Json::JsonValue;
using winrt::Windows::Data::Json::JsonValueType;

struct PlaybackEndpoint {
  const wchar_t* source;
  const wchar_t* url;
};

constexpr PlaybackEndpoint kPlaybackEndpoints[] = {
    {L"a", L"https://skrzk.pages.dev/api/playback?channel=buddies"},
    {L"b", L"https://skrzk.pages.dev/api/playback?channel=buddy46"},
};

double FirstNumber(const JsonObject& object, std::initializer_list<const wchar_t*> names) {
  for (const wchar_t* name : names) {
    const double value = json::Number(object, name, std::numeric_limits<double>::quiet_NaN());
    if (std::isfinite(value)) return value;
  }
  return 0;
}

double FirstNumberOr(const JsonObject& object, std::initializer_list<const wchar_t*> names,
                     double fallback) {
  for (const wchar_t* name : names) {
    const double value = json::Number(object, name, std::numeric_limits<double>::quiet_NaN());
    if (std::isfinite(value)) return value;
  }
  return fallback;
}

std::wstring FirstText(const JsonObject& object, std::initializer_list<const wchar_t*> names) {
  for (const wchar_t* name : names) {
    std::wstring value = json::Text(object, name);
    if (!value.empty()) return value;
  }
  return {};
}

NativePlaybackTrack NormalizeTrack(const fs::path& dataDir, const JsonObject& raw) {
  JsonObject source = raw;
  JsonObject nested = json::Object(raw, L"track");
  if (nested.Size() == 0) nested = json::Object(raw, L"song");
  if (nested.Size() != 0) source = nested;

  NativePlaybackTrack track;
  track.title = FirstText(source, {L"name", L"title", L"trackTitle"});

  std::wstring artist = FirstText(source, {L"trackArtist", L"artist"});
  if (artist.empty()) {
    const JsonArray artists = json::Array(source, L"artists");
    std::wstring joined;
    for (uint32_t index = 0; index < artists.Size(); ++index) {
      try {
        std::wstring part;
        const auto value = artists.GetAt(index);
        if (value.ValueType() == JsonValueType::String) part = value.GetString().c_str();
        else if (value.ValueType() == JsonValueType::Object) {
          part = json::Text(value.GetObject(), L"name");
        }
        if (part.empty()) continue;
        if (!joined.empty()) joined += L", ";
        joined += part;
      } catch (...) {
      }
    }
    artist = joined;
  }
  track.artist = artist;

  std::wstring artwork = FirstText(source, {
      L"artwork", L"artworkUrl", L"albumArtUrl", L"image", L"imageUrl",
      L"thumbnail_url",
  });
  if (artwork.empty()) {
    JsonObject album = json::Object(source, L"album");
    JsonArray images = json::Array(album, L"images");
    if (images.Size() > 0) {
      try {
        if (images.GetAt(0).ValueType() == JsonValueType::Object) {
          artwork = json::Text(images.GetAt(0).GetObject(), L"url");
        }
      } catch (...) {
      }
    }
  }
  track.artwork = CacheArtworkUrl(dataDir, artwork);
  track.durationMs = static_cast<int64_t>(std::max(
      0.0, FirstNumber(source, {L"durationMs", L"duration_ms", L"lengthMs"})));
  return track;
}

NativePlaybackProjection ParsePlaybackProjection(const fs::path& dataDir, const std::wstring& payload, int64_t fetchedAt) {
  NativePlaybackProjection projection;
  projection.fetchedAt = fetchedAt;
  if (payload.empty()) return projection;
  try {
    JsonObject root = JsonObject::Parse(payload);
    JsonObject value = root;
    for (const wchar_t* name : {L"playback", L"data", L"stationhead", L"result"}) {
      JsonObject child = json::Object(value, name);
      if (child.Size() != 0) {
        value = child;
        if (name == std::wstring(L"data")) {
          JsonObject nested = json::Object(value, L"playback");
          if (nested.Size() != 0) value = nested;
        }
        break;
      }
    }

    JsonObject queueStatus = json::Object(value, L"queue_status");
    if (queueStatus.Size() == 0) queueStatus = json::Object(value, L"queueStatus");

    const bool statusPaused = json::Boolean(queueStatus, L"is_paused");
    const bool playing = json::Boolean(queueStatus, L"playing", json::Boolean(value, L"playing")) ||
        (json::Boolean(value, L"is_broadcasting") && !json::Boolean(value, L"is_paused") && !statusPaused);
    const int64_t sampledAt = static_cast<int64_t>(std::max(
        0.0, FirstNumber(value, {L"sampledAt", L"monitorSampledAt", L"updatedAt",
                                 L"generated_at", L"latest_observed_at", L"queue_observed_at"})));
    const int64_t serverReferenceAt = static_cast<int64_t>(std::max(
        0.0, FirstNumber(value, {L"generated_at", L"latest_observed_at", L"queue_observed_at",
                                 L"sampledAt", L"monitorSampledAt", L"updatedAt"})));
    const int64_t anchorAt = static_cast<int64_t>(std::max(
        0.0, FirstNumber(value, {L"anchorAt", L"anchor_at"})));
    const int64_t statusAnchorAt = static_cast<int64_t>(std::max(
        0.0, FirstNumber(queueStatus, {L"anchorAt", L"anchor_at"})));
    const int64_t queueEndAt = static_cast<int64_t>(std::max(
        0.0, FirstNumber(value, {L"queueEndAt", L"queue_end_at"})));
    const int64_t statusQueueEndAt = static_cast<int64_t>(std::max(
        0.0, FirstNumber(queueStatus, {L"queueEndAt", L"queue_end_at"})));
    int64_t durationMs = static_cast<int64_t>(std::max(
        0.0, FirstNumber(value, {L"durationMs", L"duration_ms", L"trackDurationMs"})));
    int64_t progressMs = static_cast<int64_t>(std::max(
        0.0, FirstNumber(value, {L"progressMs", L"progress_ms", L"positionMs"})));
    if (progressMs <= 0) {
      progressMs = static_cast<int64_t>(std::max(
          0.0, FirstNumber(queueStatus, {L"progressMs", L"progress_ms", L"positionMs"})));
    }
    const int64_t effectiveAnchorAt = anchorAt > 0 ? anchorAt : statusAnchorAt;
    const int64_t effectiveQueueEndAt = queueEndAt > 0 ? queueEndAt : statusQueueEndAt;

    JsonArray queue = json::Array(value, L"queue");
    JsonObject itemSource = json::Object(value, L"item");
    if (itemSource.Size() == 0) itemSource = json::Object(value, L"currentItem");
    if (itemSource.Size() == 0) itemSource = json::Object(value, L"currentTrack");
    if (itemSource.Size() == 0) itemSource = json::Object(value, L"track");

    if (queue.Size() > 0) {
      int index = static_cast<int>(FirstNumberOr(value, {L"currentIndex", L"current_index"}, -1));
      if (index < 0) {
        index = static_cast<int>(FirstNumberOr(queueStatus, {L"currentIndex", L"current_index"}, -1));
      }
      if (index < 0 || index >= static_cast<int>(queue.Size())) {
        index = 0;
        for (uint32_t queueIndex = 0; queueIndex < queue.Size(); ++queueIndex) {
          try {
            if (queue.GetAt(queueIndex).ValueType() == JsonValueType::Object &&
                json::Boolean(queue.GetAt(queueIndex).GetObject(), L"is_current")) {
              index = static_cast<int>(queueIndex);
              break;
            }
          } catch (...) {
          }
        }
      }

      int64_t elapsed = progressMs;
      if (playing) {
        if (effectiveAnchorAt > 0 && serverReferenceAt > 0) {
          elapsed = std::max<int64_t>(0, serverReferenceAt - effectiveAnchorAt) +
              std::max<int64_t>(0, fetchedAt - serverReferenceAt);
        } else if (effectiveAnchorAt > 0) elapsed = std::max<int64_t>(0, fetchedAt - effectiveAnchorAt);
        else if (sampledAt > 0) elapsed += std::max<int64_t>(0, fetchedAt - sampledAt);
      }

      for (uint32_t queueIndex = 0; queueIndex < queue.Size(); ++queueIndex) {
        try {
          if (queue.GetAt(queueIndex).ValueType() == JsonValueType::Object) {
            projection.queue.push_back(NormalizeTrack(dataDir, queue.GetAt(queueIndex).GetObject()));
            continue;
          }
        } catch (...) {
        }
        projection.queue.emplace_back();
      }
      projection.currentIndex = std::clamp(index, 0, static_cast<int>(queue.Size()) - 1);
      projection.progressMs = std::max<int64_t>(0, elapsed);
    } else {
      NativePlaybackTrack track = NormalizeTrack(dataDir, itemSource);
      if (durationMs > 0) track.durationMs = durationMs;
      const int64_t expectedEndAt = static_cast<int64_t>(std::max(0.0, json::Number(value, L"expectedEndAt")));
      if (track.durationMs > 0 && expectedEndAt > 0) {
        progressMs = track.durationMs -
            std::max<int64_t>(0, expectedEndAt + kPlaybackTransitionHoldMs - fetchedAt);
      } else if (playing && sampledAt > 0) {
        progressMs += std::max<int64_t>(0, fetchedAt - sampledAt);
      }
      if (track.durationMs > 0) progressMs = std::clamp<int64_t>(progressMs, 0, track.durationMs);
      projection.currentIndex = 0;
      projection.progressMs = std::max<int64_t>(0, progressMs);
      projection.queue.push_back(std::move(track));
    }

    projection.available = !projection.queue.empty();
    projection.playing = playing;
    projection.sampledAt = fetchedAt;
    projection.anchorAt = playing ? fetchedAt - projection.progressMs : 0;
    if (effectiveQueueEndAt > 0 && serverReferenceAt > 0) {
      projection.queueEndAt = fetchedAt + std::max<int64_t>(0, effectiveQueueEndAt - serverReferenceAt);
    } else {
      projection.queueEndAt = effectiveQueueEndAt;
    }
    return projection;
  } catch (...) {
    NativePlaybackProjection failed;
    failed.fetchedAt = fetchedAt;
    return failed;
  }
}

std::wstring FetchPlaybackJson(const wchar_t* rawUrl, std::wstring* payload) {
  if (!rawUrl || !*rawUrl || !payload) return L"playback URL missing";
  payload->clear();

  std::vector<uint8_t> body;
  std::wstring error;
  if (!WinHttpDownload(rawUrl, kMaxPlaybackResponseBytes, &body, nullptr, &error,
                       L"HomePanel-Native-Playback/1.0",
                       L"Accept: application/json\r\nCache-Control: no-cache\r\nPragma: no-cache\r\n")) {
    return error.empty() ? L"playback download failed" : error;
  }

  const std::wstring wide = Utf8ToWide(std::string(body.begin(), body.end()));
  if (wide.empty()) return L"invalid UTF-8 playback response";
  try {
    const auto value = winrt::Windows::Data::Json::JsonValue::Parse(wide);
    if (value.ValueType() != winrt::Windows::Data::Json::JsonValueType::Object) {
      return L"playback response is not a JSON object";
    }
  } catch (...) {
    return L"invalid playback JSON";
  }

  *payload = wide;
  return {};
}

void SaveNativePlaybackSnapshot(const fs::path& dataDir, const wchar_t* source,
                                const std::wstring& payload,
                                const std::wstring& error,
                                int64_t fetchedAt) {
  if (!source || !*source) return;
  std::wostringstream json;
  json << L"{\"source\":" << JsonQuote(source)
       << L",\"fetchedAt\":" << fetchedAt
       << L",\"ok\":" << (error.empty() ? L"true" : L"false");
  if (!error.empty()) json << L",\"error\":" << JsonQuote(error);
  if (!payload.empty()) json << L",\"payload\":" << payload;
  json << L"}";
  AtomicWriteText(dataDir / (std::wstring(L"native-playback-") + source + L".json"),
                  WideToUtf8(json.str()));
}

struct NativePlaybackSnapshot {
  std::wstring source;
  std::wstring payload;
  NativePlaybackProjection projection;
  std::wstring error;
  int64_t fetchedAt = 0;
  bool hasPayload = false;
};

bool LoadNativePlaybackSnapshot(const fs::path& dataDir, const wchar_t* source,
                                NativePlaybackSnapshot* snapshot) {
  if (!source || !*source || !snapshot) return false;
  try {
    std::ifstream input(
        dataDir / (std::wstring(L"native-playback-") + source + L".json"),
        std::ios::binary);
    if (!input) return false;
    const std::string text((std::istreambuf_iterator<char>(input)), {});
    if (text.empty()) return false;
    const JsonObject root = JsonObject::Parse(Utf8ToWide(text));
    const std::wstring payload = json::Stringify(root, L"payload");
    const std::wstring error = json::Text(root, L"error");
    const int64_t fetchedAt = static_cast<int64_t>(std::max(
        0.0, json::Number(root, L"fetchedAt")));
    snapshot->source = source;
    snapshot->payload = payload;
    snapshot->error = error;
    snapshot->fetchedAt = fetchedAt;
    snapshot->projection = ParsePlaybackProjection(dataDir, payload, fetchedAt);
    snapshot->hasPayload = error.empty() && !payload.empty();
    return snapshot->hasPayload || !error.empty();
  } catch (...) {
    return false;
  }
}
}  // namespace

void Renderer::StartNativePlaybackBridge() {
  if (nativePlaybackStarted_.exchange(true, std::memory_order_acq_rel)) return;
  nativePlaybackStopping_ = false;
  {
    std::lock_guard lock(nativePlaybackMutex_);
    for (size_t index = 0; index < std::size(kPlaybackEndpoints); ++index) {
      NativePlaybackSnapshot loaded;
      if (!LoadNativePlaybackSnapshot(
              dataDir_, kPlaybackEndpoints[index].source, &loaded)) {
        continue;
      }
      auto& update = nativePlaybackUpdates_[index];
      update.source = std::move(loaded.source);
      update.payload = std::move(loaded.payload);
      update.error = std::move(loaded.error);
      update.fetchedAt = loaded.fetchedAt;
      update.projection = std::move(loaded.projection);
      update.hasPayload = loaded.hasPayload;
      update.revision = ++nativePlaybackRevision_;
    }
  }
  nativePlaybackThread_ = std::thread([this] { NativePlaybackLoop(); });
}

void Renderer::StopNativePlaybackBridge() noexcept {
  if (!nativePlaybackStarted_.exchange(false, std::memory_order_acq_rel)) return;
  nativePlaybackStopping_ = true;
  nativePlaybackWake_.notify_all();
  if (nativePlaybackThread_.joinable()) nativePlaybackThread_.join();
}

void Renderer::NativePlaybackLoop() {
  const HRESULT apartment = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
  while (!nativePlaybackStopping_.load(std::memory_order_acquire)) {
    for (size_t index = 0; index < std::size(kPlaybackEndpoints); ++index) {
      if (nativePlaybackStopping_.load(std::memory_order_acquire)) break;
      std::wstring payload;
      const std::wstring error = FetchPlaybackJson(kPlaybackEndpoints[index].url, &payload);
      {
        std::lock_guard lock(nativePlaybackMutex_);
        const auto& update = nativePlaybackUpdates_[index];
        if (update.payload == payload && update.error == error) continue;
      }
      const int64_t fetchedAt = UnixMillis();
      NativePlaybackProjection projection =
          ParsePlaybackProjection(dataDir_, payload, fetchedAt);
      SaveNativePlaybackSnapshot(
          dataDir_, kPlaybackEndpoints[index].source, payload, error, fetchedAt);
      {
        std::lock_guard lock(nativePlaybackMutex_);
        auto& update = nativePlaybackUpdates_[index];
        update.source = kPlaybackEndpoints[index].source;
        update.payload = std::move(payload);
        update.error = error;
        update.fetchedAt = fetchedAt;
        update.projection = std::move(projection);
        update.hasPayload = update.error.empty() && !update.payload.empty();
        update.revision = ++nativePlaybackRevision_;
      }
      const HWND stationheadWindow = nativeStationheadWindow_;
      if (stationheadWindow && IsWindow(stationheadWindow)) {
        InvalidateRect(stationheadWindow, nullptr, FALSE);
      }
    }

    std::unique_lock waitLock(nativePlaybackWakeMutex_);
    nativePlaybackWake_.wait_for(
        waitLock,
        std::chrono::milliseconds(kNativePlaybackPollMs),
        [this] { return nativePlaybackStopping_.load(std::memory_order_acquire); });
  }
  if (SUCCEEDED(apartment)) CoUninitialize();
}

}  // namespace hp
