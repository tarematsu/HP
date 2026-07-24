#pragma once
#include "common.h"
#include <winrt/Windows.Data.Json.h>

namespace hp::json {
using winrt::Windows::Data::Json::JsonArray;
using winrt::Windows::Data::Json::JsonObject;
using winrt::Windows::Data::Json::JsonValueType;

inline JsonObject Object(const JsonObject& parent, const wchar_t* name) {
  try {
    const auto value = parent.GetNamedValue(name);
    if (value.ValueType() == JsonValueType::Object) return value.GetObject();
  } catch (...) {
  }
  return JsonObject{};
}

inline JsonArray Array(const JsonObject& parent, const wchar_t* name) {
  try {
    const auto value = parent.GetNamedValue(name);
    if (value.ValueType() == JsonValueType::Array) return value.GetArray();
  } catch (...) {
  }
  return JsonArray{};
}

inline std::wstring Text(const JsonObject& object, const wchar_t* name, const std::wstring& fallback = {}) {
  try {
    const auto value = object.GetNamedValue(name);
    if (value.ValueType() == JsonValueType::String) return value.GetString().c_str();
  } catch (...) {
  }
  return fallback;
}

inline double Number(const JsonObject& object, const wchar_t* name, double fallback = 0) {
  try {
    const auto value = object.GetNamedValue(name);
    if (value.ValueType() == JsonValueType::Number) return value.GetNumber();
  } catch (...) {
  }
  return fallback;
}

inline bool Boolean(const JsonObject& object, const wchar_t* name, bool fallback = false) {
  try {
    const auto value = object.GetNamedValue(name);
    if (value.ValueType() == JsonValueType::Boolean) return value.GetBoolean();
  } catch (...) {
  }
  return fallback;
}

inline std::wstring Stringify(const JsonObject& object, const wchar_t* name) {
  try {
    return object.GetNamedValue(name).Stringify().c_str();
  } catch (...) {
  }
  return {};
}
}  // namespace hp::json
