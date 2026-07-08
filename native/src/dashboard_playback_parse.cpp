#include "web_renderer.h"
#include <winrt/Windows.Data.Json.h>

namespace hp {
namespace {
using winrt::Windows::Data::Json::JsonArray;
using winrt::Windows::Data::Json::JsonObject;
using winrt::Windows::Data::Json::JsonValueType;

JsonObject ChildObject(const JsonObject& parent, const wchar_t* name) {
  try {
    if (parent.HasKey(name) &&
        parent.GetNamedValue(name).ValueType() == JsonValueType::Object) {
      return parent.GetNamedObject(name);
    }
  } catch (...) {
  }
  return JsonObject{};
}

JsonArray ChildArray(const JsonObject& parent, const wchar_t* name) {
  try {
    if (parent.HasKey(name) &&
        parent.GetNamedValue(name).ValueType() == JsonValueType::Array) {
      return parent.GetNamedArray(name);
    }
  } catch (...) {
  }
  return JsonArray{};
}

std::wstring TextValue(const JsonObject& object, const wchar_t* name) {
  try {
    if (object.HasKey(name) &&
        object.GetNamedValue(name).ValueType() == JsonValueType::String) {
      return object.GetNamedString(name).c_str();
    }
  } catch (...) {
  }
  return {};
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
