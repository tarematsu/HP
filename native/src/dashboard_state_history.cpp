#include "web_renderer.h"

namespace hp::statejson {
std::wstring History(const std::vector<int>& values) {
  std::wostringstream json;
  json << L"[";
  for (size_t index = 0; index < values.size(); ++index) {
    if (index) json << L",";
    json << values[index];
  }
  json << L"]";
  return json.str();
}
}  // namespace hp::statejson
