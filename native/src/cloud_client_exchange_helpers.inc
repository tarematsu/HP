namespace hp {
namespace {
std::wstring ExchangeQueryValue(const std::wstring& path, const wchar_t* name) {
  const std::wstring token = std::wstring(name) + L"=";
  size_t start = path.find(L'?');
  start = start == std::wstring::npos ? start : start + 1;
  while (start != std::wstring::npos && start < path.size()) {
    const size_t end = path.find(L'&', start);
    const size_t limit = end == std::wstring::npos ? path.size() : end;
    if (path.compare(start, token.size(), token) == 0) {
      return path.substr(start + token.size(), limit - start - token.size());
    }
    start = end == std::wstring::npos ? end : end + 1;
  }
  return {};
}

uint32_t ExchangeReadUint32(const std::vector<uint8_t>& bytes, size_t offset) {
  if (offset + 4 > bytes.size()) throw std::runtime_error("device exchange truncated");
  return static_cast<uint32_t>(bytes[offset])
      | static_cast<uint32_t>(bytes[offset + 1]) << 8
      | static_cast<uint32_t>(bytes[offset + 2]) << 16
      | static_cast<uint32_t>(bytes[offset + 3]) << 24;
}

TelemetryReceipt ParseExchangeTelemetryReceipt(const JsonObject& object) {
  TelemetryReceipt receipt;
  if (!object.HasKey(L"acknowledgedSequences") ||
      object.GetNamedValue(L"acknowledgedSequences").ValueType() != JsonValueType::Array) return receipt;
  const double next = object.GetNamedNumber(L"nextSequence", -1);
  if (!std::isfinite(next) || std::floor(next) != next ||
      next <= 0 || next > 9'007'199'254'740'991.0) return receipt;
  const JsonArray values = object.GetNamedArray(L"acknowledgedSequences");
  receipt.nextSequence = static_cast<uint64_t>(next);
  receipt.acknowledgedSequences.reserve(values.Size());
  for (const auto& value : values) {
    if (value.ValueType() != JsonValueType::Number) return {};
    const double sequence = value.GetNumber();
    if (!std::isfinite(sequence) || std::floor(sequence) != sequence ||
        sequence <= 0 || sequence > 9'007'199'254'740'991.0) return {};
    receipt.acknowledgedSequences.push_back(static_cast<uint64_t>(sequence));
  }
  std::sort(receipt.acknowledgedSequences.begin(), receipt.acknowledgedSequences.end());
  receipt.acknowledgedSequences.erase(
      std::unique(receipt.acknowledgedSequences.begin(), receipt.acknowledgedSequences.end()),
      receipt.acknowledgedSequences.end());
  receipt.success = true;
  return receipt;
}
}  // namespace
}  // namespace hp
