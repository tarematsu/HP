#include "web_renderer.h"
#include "json_helpers.h"
#include <winrt/Windows.Data.Json.h>

namespace hp {
namespace {
using winrt::Windows::Data::Json::JsonArray;
using winrt::Windows::Data::Json::JsonObject;

JsonObject ChildObject(const JsonObject& parent, const wchar_t* name) {
  return json::Object(parent, name);
}

JsonArray ChildArray(const JsonObject& parent, const wchar_t* name) {
  return json::Array(parent, name);
}

std::wstring TextValue(const JsonObject& object, const wchar_t* name) {
  return json::Text(object, name);
}
}  // namespace

void Renderer::ParseDashboardMetadata(const std::wstring& json) {
  newsCount_ = 0;
  monitorHostHandle_.clear();

  const JsonObject root = JsonObject::Parse(json);
  newsCount_ = static_cast<int>(ChildArray(ChildObject(root, L"news"), L"items").Size());

  const JsonObject stationhead = ChildObject(root, L"stationhead");
  monitorHostHandle_ = TextValue(ChildObject(stationhead, L"host"), L"handle");
}
}  // namespace hp
