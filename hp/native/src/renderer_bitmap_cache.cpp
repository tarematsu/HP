#include "web_renderer.h"
#include "wic_image.h"

namespace hp {
namespace {
constexpr size_t kNativeImageBitmapCacheLimit = 16;
constexpr size_t kWeatherIconBitmapCacheLimit = 32;
constexpr size_t kRadarBitmapCacheLimit = 12;
constexpr int64_t kNativeImageDecodeRetryMs = 60'000;

bool IsPersistentRadarBitmap(const std::wstring& key) {
  return key.rfind(L"radar-satellite#", 0) == 0 ||
         key.rfind(L"radar-map#", 0) == 0;
}

template <typename Cache, typename Loader>
HBITMAP CachedBitmap(Cache& cache, uint64_t& useCounter, size_t limit,
                     const std::wstring& key, Loader&& load) {
  auto found = cache.find(key);
  if (found != cache.end()) {
    if (found->second.bitmap) {
      found->second.lastUsed = ++useCounter;
      return found->second.bitmap;
    }
    if (UnixMillis() < static_cast<int64_t>(found->second.lastUsed)) return nullptr;
    cache.erase(found);
  }
  if (cache.size() >= limit) {
    auto oldest = cache.end();
    for (auto item = cache.begin(); item != cache.end(); ++item) {
      if (!item->second.bitmap) { oldest = item; break; }
      if (oldest == cache.end() || item->second.lastUsed < oldest->second.lastUsed) oldest = item;
    }
    if (oldest != cache.end()) {
      if (oldest->second.bitmap) DeleteObject(oldest->second.bitmap);
      cache.erase(oldest);
    }
  }
  HBITMAP bitmap = load();
  const uint64_t stamp = bitmap ? ++useCounter
      : static_cast<uint64_t>(UnixMillis() + kNativeImageDecodeRetryMs);
  cache[key] = {bitmap, stamp};
  return bitmap;
}
}  // namespace

HBITMAP Renderer::NativePanelBackBuffer(HWND hwnd, HDC dc, int width, int height) {
  if (!hwnd || !dc || width <= 0 || height <= 0) return nullptr;
  PanelBackBuffer& buffer = nativeBackBuffers_[hwnd];
  if (buffer.bitmap && buffer.width == width && buffer.height == height) return buffer.bitmap;
  if (buffer.bitmap) DeleteObject(buffer.bitmap);
  buffer.bitmap = CreateCompatibleBitmap(dc, width, height);
  buffer.width = buffer.bitmap ? width : 0;
  buffer.height = buffer.bitmap ? height : 0;
  return buffer.bitmap;
}

void Renderer::ReleaseNativePanelBackBuffer(HWND hwnd) {
  const auto found = nativeBackBuffers_.find(hwnd);
  if (found == nativeBackBuffers_.end()) return;
  if (found->second.bitmap) DeleteObject(found->second.bitmap);
  nativeBackBuffers_.erase(found);
}

HBITMAP Renderer::NativeArtworkBitmap(const std::wstring& url, int width, int height) {
  if (url.empty() || width <= 0 || height <= 0) return nullptr;
  static constexpr wchar_t kDataHostPrefix[] = L"https://data.homepanel/";
  if (url.rfind(kDataHostPrefix, 0) != 0) return nullptr;
  const std::wstring key = url + L"#" + std::to_wstring(width) + L"x" + std::to_wstring(height);
  return CachedBitmap(nativeImageBitmaps_, nativeImageUseCounter_,
                      kNativeImageBitmapCacheLimit, key, [&] {
    std::wstring relative = url.substr(std::size(kDataHostPrefix) - 1);
    if (relative.empty() || relative.find(L"..") != std::wstring::npos) return HBITMAP{};
    for (auto& character : relative) if (character == L'/') character = L'\\';
    return DecodeImageFileToBitmap(dataDir_ / relative, width, height);
  });
}

HBITMAP Renderer::NativeWeatherIconBitmap(
    const std::wstring& icon, bool night, int width, int height) {
  if (icon.empty() || width <= 0 || height <= 0) return nullptr;
  for (wchar_t character : icon) if (character < L'0' || character > L'9') return nullptr;
  const std::wstring fileName = icon + (night ? L"_night.png" : L"_day.png");
  const std::wstring key = fileName + L"#" + std::to_wstring(width) + L"x" + std::to_wstring(height);
  return CachedBitmap(nativeWeatherIconBitmaps_, nativeWeatherIconUseCounter_,
                      kWeatherIconBitmapCacheLimit, key, [&] {
    const auto decodeIcon = [&](const std::wstring& name) {
      return DecodeImageFileToBitmap(rootDir_ / L"ui" / L"weather-icons" / name, width, height);
    };
    HBITMAP bitmap = decodeIcon(fileName);
    if (!bitmap && night) bitmap = decodeIcon(icon + L"_day.png");
    if (!bitmap) {
      const wchar_t family = icon.front();
      const std::wstring fallback = icon == L"430" ? L"400" :
          (icon == L"500" || icon == L"550") ? L"100" :
          icon == L"600" ? L"200" :
          (icon == L"650" || icon == L"850") ? L"300" :
          icon == L"950" ? L"400" :
          family == L'2' ? L"200" :
          family == L'3' ? L"300" : family == L'4' ? L"400" : L"100";
      bitmap = decodeIcon(fallback + (night ? L"_night.png" : L"_day.png"));
      if (!bitmap && night) bitmap = decodeIcon(fallback + L"_day.png");
    }
    return bitmap;
  });
}

HBITMAP Renderer::CachedRadarBitmap(
    const std::wstring& key, const fs::path& path, const std::string& fileStamp,
    int width, int height) {
  if (width <= 0 || height <= 0) return nullptr;
  const std::wstring keyPrefix = key + L"#";
  const std::wstring cacheKey = keyPrefix + Utf8ToWide(fileStamp) + L"#" +
      std::to_wstring(width) + L"x" + std::to_wstring(height);
  auto found = nativeRadarBitmaps_.find(cacheKey);
  if (found != nativeRadarBitmaps_.end()) {
    found->second.lastUsed = ++nativeRadarBitmapUseCounter_;
    return found->second.bitmap;
  }
  HBITMAP bitmap = DecodeImageFileToBitmap(path, width, height);
  if (!bitmap) return nullptr;
  for (auto item = nativeRadarBitmaps_.begin(); item != nativeRadarBitmaps_.end();) {
    if (item->first.rfind(keyPrefix, 0) != 0) { ++item; continue; }
    if (item->second.bitmap) DeleteObject(item->second.bitmap);
    item = nativeRadarBitmaps_.erase(item);
  }
  if (nativeRadarBitmaps_.size() >= kRadarBitmapCacheLimit) {
    auto oldest = nativeRadarBitmaps_.end();
    for (auto item = nativeRadarBitmaps_.begin(); item != nativeRadarBitmaps_.end(); ++item) {
      if (IsPersistentRadarBitmap(item->first)) continue;
      if (oldest == nativeRadarBitmaps_.end() || item->second.lastUsed < oldest->second.lastUsed) oldest = item;
    }
    if (oldest != nativeRadarBitmaps_.end()) {
      if (oldest->second.bitmap) DeleteObject(oldest->second.bitmap);
      nativeRadarBitmaps_.erase(oldest);
    }
  }
  nativeRadarBitmaps_[cacheKey] = BitmapCacheEntry{bitmap, ++nativeRadarBitmapUseCounter_};
  return bitmap;
}

void Renderer::ReleaseNativePanelSurfaces() noexcept {
  for (auto& item : nativeBackBuffers_) if (item.second.bitmap) DeleteObject(item.second.bitmap);
  nativeBackBuffers_.clear();
}

void Renderer::ResetNativeBitmapCaches() noexcept {
  ReleaseNativePanelSurfaces();
  if (energyBitmapCache_.bitmap) DeleteObject(energyBitmapCache_.bitmap);
  energyBitmapCache_ = {};
  const auto deleteBitmaps = [](auto& entries) {
    for (auto& item : entries) if (item.second.bitmap) DeleteObject(item.second.bitmap);
    entries.clear();
  };
  deleteBitmaps(nativeImageBitmaps_);
  nativeImageUseCounter_ = 0;
  deleteBitmaps(nativeWeatherIconBitmaps_);
  nativeWeatherIconUseCounter_ = 0;
  deleteBitmaps(nativeRadarBitmaps_);
  nativeRadarBitmapUseCounter_ = 0;
}

}  // namespace hp
