// Radar payload localization and on-disk cache maintenance.
// Included by cloud_client.cpp so it shares CloudClient's private implementation
// helpers without adding another externally visible interface.
#include "cloud_client.h"
#include <limits>
#include <set>
#include <winrt/Windows.Data.Json.h>

namespace hp {
namespace {
std::wstring RadarUtf8BytesToWide(const std::vector<uint8_t>& bytes) {
  if (bytes.empty() ||
      bytes.size() > static_cast<size_t>(std::numeric_limits<int>::max())) {
    return {};
  }
  const char* const input = reinterpret_cast<const char*>(bytes.data());
  const int inputSize = static_cast<int>(bytes.size());
  const int outputSize = MultiByteToWideChar(
      CP_UTF8, MB_ERR_INVALID_CHARS, input, inputSize, nullptr, 0);
  if (outputSize <= 0) return {};
  std::wstring output(static_cast<size_t>(outputSize), L'\0');
  if (MultiByteToWideChar(
          CP_UTF8, MB_ERR_INVALID_CHARS, input, inputSize,
          output.data(), outputSize) != outputSize) {
    return {};
  }
  return output;
}

bool HasPngSignature(const std::vector<uint8_t>& body) noexcept {
  static constexpr uint8_t kPngSignature[] = {
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a};
  return body.size() >= sizeof(kPngSignature) &&
      std::memcmp(body.data(), kPngSignature, sizeof(kPngSignature)) == 0;
}

bool HasPngSignature(const fs::path& path) noexcept {
  try {
    std::ifstream input(path, std::ios::binary);
    if (!input) return false;
    uint8_t signature[8]{};
    input.read(reinterpret_cast<char*>(signature), sizeof(signature));
    if (input.gcount() != static_cast<std::streamsize>(sizeof(signature))) {
      return false;
    }
    const std::vector<uint8_t> bytes(std::begin(signature), std::end(signature));
    return HasPngSignature(bytes);
  } catch (...) {
    return false;
  }
}
}  // namespace

std::vector<uint8_t> CloudClient::LocalizeRadarTiles(
    const std::vector<uint8_t>& body) {
  const fs::path cacheRoot = dataDir_ / L"radar-cache";
  const auto pathOnly = [](const std::wstring& url) {
    const size_t query = url.find_first_of(L"?#");
    return url.substr(0, query);
  };
  const auto localPathFor = [&](const std::wstring& url) -> fs::path {
    const std::wstring pathname = pathOnly(url);
    fs::path path = cacheRoot;
    size_t start = 0;
    while (start < pathname.size() && pathname[start] == L'/') ++start;
    while (start < pathname.size()) {
      const size_t slash = pathname.find(L'/', start);
      const std::wstring part = pathname.substr(
          start, slash == std::wstring::npos ? std::wstring::npos : slash - start);
      if (part.empty() || part == L"." || part == L".." ||
          part.find_first_of(L"\\:*?\"<>|") != std::wstring::npos) {
        throw std::runtime_error("invalid radar tile path");
      }
      path /= part;
      if (slash == std::wstring::npos) break;
      start = slash + 1;
    }
    return path.lexically_normal();
  };
  const auto localUrlFor = [&](const std::wstring& url) {
    const std::wstring pathname = pathOnly(url);
    return L"https://data.homepanel/radar-cache" +
        (pathname.empty() || pathname.front() == L'/' ? pathname : L"/" + pathname);
  };
  const auto remoteUrlFor = [this](const std::wstring& url) {
    std::wstring base = config_.cloudflareBaseUrl;
    while (!base.empty() && base.back() == L'/') base.pop_back();
    return base + (url.empty() || url.front() == L'/' ? url : L"/" + url);
  };

  JsonObject root = JsonObject::Parse(RadarUtf8BytesToWide(body));
  const bool precomposed = root.GetNamedBoolean(L"precomposed", false);
  if (precomposed) {
    const int width = static_cast<int>(root.GetNamedNumber(L"width", 0));
    const int height = static_cast<int>(root.GetNamedNumber(L"height", 0));
    const JsonArray frames = root.GetNamedArray(L"frames", JsonArray{});
    if (width != 1920 || height != 1280 || frames.Size() != 1 ||
        frames.GetAt(0).ValueType() != JsonValueType::Object) {
      throw std::runtime_error("precomposed radar payload shape invalid");
    }
    const JsonObject frame = frames.GetAt(0).GetObject();
    const JsonArray tiles = frame.GetNamedArray(L"tiles", JsonArray{});
    if (tiles.Size() != 1 || tiles.GetAt(0).ValueType() != JsonValueType::Object) {
      throw std::runtime_error("precomposed radar frame must contain one image");
    }
    const JsonObject tile = tiles.GetAt(0).GetObject();
    const std::wstring url = tile.GetNamedString(L"url", L"").c_str();
    if (url.empty() || url.front() != L'/') {
      throw std::runtime_error("precomposed radar frame URL must be relative");
    }
    const auto response = Request(L"GET", url, deviceToken_);
    if (response.status != 200 || !HasPngSignature(response.body)) {
      throw std::runtime_error(
          "precomposed radar frame unavailable: HTTP " +
          std::to_string(response.status));
    }
    const fs::path target = localPathFor(url);
    if (!AtomicWriteBytes(target, response.body) || !HasPngSignature(target)) {
      throw std::runtime_error("precomposed radar frame cache write failed");
    }
    tile.SetNamedValue(L"url", JsonValue::CreateStringValue(localUrlFor(url)));
    const std::string text = WideToUtf8(root.Stringify().c_str());
    return {text.begin(), text.end()};
  }

  std::set<std::wstring> retained;
  const std::wstring bundleUrl = root.GetNamedString(L"bundleUrl", L"").c_str();
  if (!bundleUrl.empty() && bundleUrl.front() == L'/') {
    try {
      const auto response = Request(L"GET", bundleUrl, deviceToken_);
      if (response.status != 200 || response.body.size() < 12) {
        throw std::runtime_error("radar bundle HTTP " + std::to_string(response.status));
      }
      static constexpr char kBundleMagic[] = "HPRB0001";
      if (std::memcmp(response.body.data(), kBundleMagic, 8) != 0) {
        throw std::runtime_error("radar bundle magic mismatch");
      }
      size_t offset = 8;
      const auto readUint16 = [&](uint16_t& value) {
        if (offset + 2 > response.body.size()) {
          throw std::runtime_error("radar bundle truncated");
        }
        value = static_cast<uint16_t>(response.body[offset]) |
            static_cast<uint16_t>(response.body[offset + 1]) << 8;
        offset += 2;
      };
      const auto readUint32 = [&](uint32_t& value) {
        if (offset + 4 > response.body.size()) {
          throw std::runtime_error("radar bundle truncated");
        }
        value = static_cast<uint32_t>(response.body[offset]) |
            static_cast<uint32_t>(response.body[offset + 1]) << 8 |
            static_cast<uint32_t>(response.body[offset + 2]) << 16 |
            static_cast<uint32_t>(response.body[offset + 3]) << 24;
        offset += 4;
      };
      uint32_t recordCount = 0;
      readUint32(recordCount);
      if (recordCount == 0 || recordCount > 256) {
        throw std::runtime_error("radar bundle record count invalid");
      }
      for (uint32_t record = 0; record < recordCount; ++record) {
        uint16_t pathLength = 0;
        uint32_t bodyLength = 0;
        readUint16(pathLength);
        readUint32(bodyLength);
        if (pathLength == 0 || bodyLength == 0 ||
            offset + static_cast<size_t>(pathLength) +
                    static_cast<size_t>(bodyLength) > response.body.size()) {
          throw std::runtime_error("radar bundle record invalid");
        }
        const std::string pathUtf8(
            reinterpret_cast<const char*>(response.body.data() + offset),
            pathLength);
        offset += pathLength;
        const std::wstring pathname = Utf8ToWide(pathUtf8);
        if (!pathname.starts_with(L"/v1/radar/tile/jma/")) {
          throw std::runtime_error("radar bundle path invalid");
        }
        const fs::path target = localPathFor(pathname);
        retained.insert(target.wstring());
        std::error_code error;
        if (!fs::exists(target, error) || fs::file_size(target, error) == 0) {
          if (!AtomicWriteBytes(target, response.body.data() + offset, bodyLength)) {
            throw std::runtime_error("radar bundle cache write failed");
          }
        }
        offset += bodyLength;
      }
      if (offset != response.body.size()) {
        throw std::runtime_error("radar bundle trailing data");
      }
    } catch (const std::exception& error) {
      log_.Warn(L"Radar bundle fetch failed; falling back to individual tiles: " +
                Utf8ToWide(error.what()));
    }
  }

  const auto localizeTile = [&](JsonObject item) {
    const std::wstring url = item.GetNamedString(L"url", L"").c_str();
    if (url.empty() || url.front() != L'/') return;
    const fs::path target = localPathFor(url);
    retained.insert(target.wstring());
    std::error_code error;
    if (!fs::exists(target, error) || fs::file_size(target, error) == 0) {
      const auto response = Request(L"GET", url, deviceToken_);
      if (response.status != 200 || response.body.empty()) {
        log_.Warn(L"Radar tile cache fetch failed; using remote tile URL: HTTP " +
                  std::to_wstring(response.status));
        item.SetNamedValue(L"url", JsonValue::CreateStringValue(remoteUrlFor(url)));
        return;
      }
      if (!AtomicWriteBytes(target, response.body)) {
        log_.Warn(L"Radar tile cache write failed; using remote tile URL");
        item.SetNamedValue(L"url", JsonValue::CreateStringValue(remoteUrlFor(url)));
        return;
      }
    }
    item.SetNamedValue(L"url", JsonValue::CreateStringValue(localUrlFor(url)));
  };

  if (root.HasKey(L"frames") &&
      root.GetNamedValue(L"frames").ValueType() == JsonValueType::Array) {
    for (auto frameValue : root.GetNamedArray(L"frames")) {
      if (frameValue.ValueType() != JsonValueType::Object) continue;
      const JsonObject frame = frameValue.GetObject();
      if (!frame.HasKey(L"tiles") ||
          frame.GetNamedValue(L"tiles").ValueType() != JsonValueType::Array) {
        continue;
      }
      for (auto tileValue : frame.GetNamedArray(L"tiles")) {
        if (tileValue.ValueType() == JsonValueType::Object) {
          localizeTile(tileValue.GetObject());
        }
      }
    }
  }

  if (!retained.empty()) {
    std::vector<fs::path> staleFiles;
    std::vector<fs::path> directories;
    std::error_code walkError;
    fs::recursive_directory_iterator iterator(
        cacheRoot, fs::directory_options::skip_permission_denied, walkError);
    const fs::recursive_directory_iterator end;
    while (!walkError && iterator != end) {
      const fs::path current = iterator->path().lexically_normal();
      std::error_code itemError;
      if (iterator->is_regular_file(itemError) &&
          !retained.contains(current.wstring())) {
        staleFiles.push_back(current);
      } else if (!itemError && iterator->is_directory(itemError)) {
        directories.push_back(current);
      }
      iterator.increment(walkError);
    }
    for (const auto& stale : staleFiles) {
      std::error_code ignored;
      fs::remove(stale, ignored);
    }
    std::sort(
        directories.begin(), directories.end(),
        [](const fs::path& left, const fs::path& right) {
          return left.native().size() > right.native().size();
        });
    for (const auto& directory : directories) {
      std::error_code ignored;
      fs::remove(directory, ignored);
    }
  }

  const std::string text = WideToUtf8(root.Stringify().c_str());
  return {text.begin(), text.end()};
}

}  // namespace hp
