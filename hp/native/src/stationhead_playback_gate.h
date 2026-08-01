#pragma once

#include "winhttp_helpers.h"
#include <winrt/Windows.Data.Json.h>

namespace hp {
namespace stationhead_playback_gate {

using winrt::Windows::Data::Json::JsonArray;
using winrt::Windows::Data::Json::JsonObject;
using winrt::Windows::Data::Json::JsonValueType;

inline constexpr wchar_t kPlaybackUrl[] =
    L"https://skrzk.pages.dev/api/dashboard?history=0";
inline constexpr size_t kMaximumResponseBytes = 4 * 1024 * 1024;

inline JsonObject Object(const JsonObject& parent, const wchar_t* key) {
  try { return parent.GetNamedObject(key); } catch (...) { return JsonObject{}; }
}

inline JsonArray Array(const JsonObject& parent, const wchar_t* key) {
  try { return parent.GetNamedArray(key); } catch (...) { return JsonArray{}; }
}

inline bool BooleanOrNumber(const JsonObject& object, const wchar_t* key,
                            bool fallback = false) {
  try {
    const auto value = object.GetNamedValue(key);
    if (value.ValueType() == JsonValueType::Boolean) return value.GetBoolean();
    if (value.ValueType() == JsonValueType::Number) return value.GetNumber() != 0;
  } catch (...) {
  }
  return fallback;
}

inline int Integer(const JsonObject& object, const wchar_t* key,
                   int fallback = -1) {
  try {
    const double value = object.GetNamedNumber(key);
    if (!std::isfinite(value) ||
        value < static_cast<double>(std::numeric_limits<int>::min()) ||
        value > static_cast<double>(std::numeric_limits<int>::max())) {
      return fallback;
    }
    return static_cast<int>(std::trunc(value));
  } catch (...) {
    return fallback;
  }
}

inline std::wstring Text(const JsonObject& object, const wchar_t* key) {
  try { return object.GetNamedString(key, L"").c_str(); } catch (...) { return {}; }
}

inline bool PayloadHasUsableCurrentTrack(const std::wstring& payload) {
  if (payload.empty()) return false;
  try {
    const JsonObject root = JsonObject::Parse(payload);
    if (!BooleanOrNumber(root, L"ok") || BooleanOrNumber(root, L"stale") ||
        BooleanOrNumber(root, L"setup_required")) {
      return false;
    }

    const JsonArray queue = Array(root, L"queue");
    const JsonObject status = Object(root, L"queue_status");
    int markedCurrentIndex = -1;
    for (uint32_t index = 0; index < queue.Size(); ++index) {
      if (queue.GetAt(index).ValueType() != JsonValueType::Object) continue;
      const JsonObject item = queue.GetAt(index).GetObject();
      if (markedCurrentIndex < 0 && BooleanOrNumber(item, L"is_current")) {
        markedCurrentIndex = static_cast<int>(index);
      }
    }

    int currentIndex = Integer(status, L"current_index", markedCurrentIndex);
    if (currentIndex < 0 || currentIndex >= static_cast<int>(queue.Size())) {
      currentIndex = markedCurrentIndex;
    }
    if (currentIndex < 0 || currentIndex >= static_cast<int>(queue.Size()) ||
        BooleanOrNumber(status, L"is_paused") ||
        BooleanOrNumber(status, L"ended", BooleanOrNumber(root, L"ended")) ||
        !BooleanOrNumber(
            status, L"playing", BooleanOrNumber(root, L"playing"))) {
      return false;
    }

    const auto value = queue.GetAt(static_cast<uint32_t>(currentIndex));
    if (value.ValueType() != JsonValueType::Object) return false;
    const JsonObject current = value.GetObject();
    return !Text(current, L"title").empty() ||
        !Text(current, L"artist").empty() ||
        !Text(current, L"thumbnail_url").empty();
  } catch (...) {
    return false;
  }
}

}  // namespace stationhead_playback_gate

inline bool StationheadPrimaryPlaybackAvailableNow() {
  std::wstring requestUrl(stationhead_playback_gate::kPlaybackUrl);
  requestUrl += L"&_hp=" + std::to_wstring(UnixMillis());

  std::vector<uint8_t> body;
  std::wstring error;
  if (!WinHttpDownload(
          requestUrl, stationhead_playback_gate::kMaximumResponseBytes,
          &body, nullptr, &error,
          L"HomePanel-Stationhead-Playback-Gate/1.0",
          L"Accept: application/json\r\nCache-Control: no-cache, no-store\r\nPragma: no-cache\r\n",
          1'500, false)) {
    return false;
  }
  const std::wstring payload = Utf8ToWide(std::string(body.begin(), body.end()));
  return stationhead_playback_gate::PayloadHasUsableCurrentTrack(payload);
}

}  // namespace hp
