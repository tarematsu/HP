#include "web_renderer.h"

namespace hp::statejson {
namespace {
std::wstring Quote(const std::wstring& value) {
  std::wstring output = L"\"";
  for (wchar_t c : value) {
    if (c == L'\\' || c == L'\"') output.push_back(L'\\');
    if (c == L'\n') output += L"\\n";
    else if (c != L'\r') output.push_back(c);
  }
  return output + L"\"";
}
std::wstring Presence(PresenceState value) {
  if (value == PresenceState::Home) return L"home";
  if (value == PresenceState::Away) return L"away";
  return L"unknown";
}
}

std::wstring Sensors(const SensorSnapshot& value) {
  std::wostringstream json;
  json << L"{\"connected\":" << (value.co2Connected ? L"true" : L"false")
       << L",\"co2\":" << value.co2
       << L",\"temperature\":" << value.temperatureCorrected
       << L",\"humidity\":" << value.humidityCorrected
       << L",\"presence\":" << Quote(Presence(value.presence))
       << L",\"light\":" << (value.light ? L"true" : L"false")
       << L",\"motion\":" << (value.motion ? L"true" : L"false")
       << L",\"doorOpen\":" << (value.doorOpen ? L"true" : L"false")
       << L",\"outboxCount\":" << value.outboxCount
       << L",\"lastError\":" << Quote(value.lastError) << L"}";
  return json.str();
}
}  // namespace hp::statejson
