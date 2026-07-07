#include "web_renderer.h"
#include <winrt/Windows.Data.Json.h>

namespace hp {
namespace {
using winrt::Windows::Data::Json::JsonArray;
using winrt::Windows::Data::Json::JsonObject;
using winrt::Windows::Data::Json::JsonValueType;

JsonObject ChildObject(const JsonObject& parent, const wchar_t* name) {
  try {
    if (parent.HasKey(name) && parent.GetNamedValue(name).ValueType() == JsonValueType::Object) {
      return parent.GetNamedObject(name);
    }
  } catch (...) {}
  return JsonObject{};
}

JsonArray ChildArray(const JsonObject& parent, const wchar_t* name) {
  try {
    if (parent.HasKey(name) && parent.GetNamedValue(name).ValueType() == JsonValueType::Array) {
      return parent.GetNamedArray(name);
    }
  } catch (...) {}
  return JsonArray{};
}

std::wstring TextValue(const JsonObject& object, const wchar_t* name) {
  try {
    if (object.HasKey(name) && object.GetNamedValue(name).ValueType() == JsonValueType::String) {
      return object.GetNamedString(name).c_str();
    }
  } catch (...) {}
  return {};
}

int64_t IntegerValue(const JsonObject& object, const wchar_t* name, int64_t fallback = 0) {
  try {
    if (object.HasKey(name) && object.GetNamedValue(name).ValueType() == JsonValueType::Number) {
      const double value = object.GetNamedNumber(name);
      if (std::isfinite(value)) return static_cast<int64_t>(value);
    }
  } catch (...) {}
  return fallback;
}

bool BooleanValue(const JsonObject& object, const wchar_t* name, bool fallback = false) {
  try {
    if (object.HasKey(name) && object.GetNamedValue(name).ValueType() == JsonValueType::Boolean) {
      return object.GetNamedBoolean(name);
    }
  } catch (...) {}
  return fallback;
}
}  // namespace

void Renderer::ParseDashboardMetadata(const std::wstring& json) {
  newsCount_ = 0;
  monitorHostHandle_.clear();
  cloudPlayback_ = CloudPlaybackState{};
  lastResolvedPlaybackIndex_ = -2;

  const JsonObject root = JsonObject::Parse(json);
  newsCount_ = static_cast<int>(ChildArray(ChildObject(root, L"news"), L"items").Size());

  const JsonObject stationhead = ChildObject(root, L"stationhead");
  monitorHostHandle_ = TextValue(ChildObject(stationhead, L"host"), L"handle");

  CloudPlaybackState next;
  next.playing = BooleanValue(stationhead, L"playing");
  next.currentIndex = static_cast<int>(IntegerValue(stationhead, L"currentIndex", -1));
  next.sampledAt = IntegerValue(stationhead, L"monitorSampledAt", IntegerValue(stationhead, L"sampledAt"));
  next.anchorAt = IntegerValue(stationhead, L"anchorAt");
  next.progressMs = std::max<int64_t>(0, IntegerValue(stationhead, L"progressMs"));
  next.queueEndAt = IntegerValue(stationhead, L"queueEndAt");

  const JsonArray queue = ChildArray(stationhead, L"queue");
  next.queue.reserve(queue.Size());
  for (uint32_t index = 0; index < queue.Size(); ++index) {
    try {
      if (queue.GetAt(index).ValueType() != JsonValueType::Object) continue;
      const JsonObject item = queue.GetObjectAt(index);
      CloudPlaybackItem parsed;
      parsed.name = TextValue(item, L"name");
      parsed.artist = TextValue(item, L"artist");
      parsed.artwork = TextValue(item, L"artwork");
      parsed.durationMs = std::max<int64_t>(0, IntegerValue(item, L"durationMs"));
      parsed.key = TextValue(item, L"spotifyId");
      if (parsed.key.empty()) parsed.key = TextValue(item, L"uri");
      if (parsed.key.empty()) parsed.key = parsed.name + L"\n" + parsed.artist + L"\n" + std::to_wstring(index);
      next.queue.push_back(std::move(parsed));
    } catch (...) {}
  }
  next.available = !next.queue.empty();
  cloudPlayback_ = std::move(next);
  lastResolvedPlaybackIndex_ = ResolvePlaybackIndex(UnixMillis());
}
}  // namespace hp
