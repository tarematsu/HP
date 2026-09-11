#include "web_renderer.h"
#include "wic_image.h"

namespace hp {
namespace {
constexpr size_t kNativeImageBitmapCacheLimit = 16;
constexpr size_t kWeatherIconBitmapCacheLimit = 32;
constexpr size_t kRadarBitmapCacheLimit = 12;
constexpr int64_t kNativeImageDecodeRetryMs = 60'000;

struct CachedBitmapMemoryDc {
  HDC value = nullptr;
  ~CachedBitmapMemoryDc() { if (value) DeleteDC(value); }
};

HDC BitmapMemoryDc(HDC compatibleDc) {
  thread_local CachedBitmapMemoryDc cached;
  if (!cached.value) cached.value = CreateCompatibleDC(compatibleDc);
  return cached.value;
}

bool IsPersistentRadarBitmap(const std::wstring& key) {
  return key.rfind(L"radar-satellite#", 0) == 0 ||
         key.rfind(L"radar-map#", 0) == 0;
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

bool Renderer::DrawCachedWeatherPanel(HDC dc, const RECT& card) {
  const int width = static_cast<int>(card.right - card.left);
  const int height = static_cast<int>(card.bottom - card.top);
  if (!dc || width <= 0 || height <= 0 || !weatherPanelCache_.bitmap ||
      weatherPanelCache_.width != width || weatherPanelCache_.height != height ||
      weatherPanelCache_.revision != nativeDashboard_.revisions.weather ||
      weatherPanelCache_.outage != nativeDashboard_.weatherOutage) return false;
  HDC source = BitmapMemoryDc(dc);
  if (!source) return false;
  HGDIOBJ previous = SelectObject(source, weatherPanelCache_.bitmap);
  if (!previous || previous == HGDI_ERROR) return false;
  const BOOL copied = BitBlt(dc, card.left, card.top, width, height, source, 0, 0, SRCCOPY);
  SelectObject(source, previous);
  return copied != FALSE;
}

void Renderer::CaptureWeatherPanel(HDC dc, const RECT& card) {
  const int width = static_cast<int>(card.right - card.left);
  const int height = static_cast<int>(card.bottom - card.top);
  if (!dc || width <= 0 || height <= 0) return;
  RECT clip{};
  if (GetClipBox(dc, &clip) == ERROR || clip.left > card.left || clip.top > card.top ||
      clip.right < card.right || clip.bottom < card.bottom) return;
  if (!weatherPanelCache_.bitmap || weatherPanelCache_.width != width ||
      weatherPanelCache_.height != height) {
    HBITMAP replacement = CreateCompatibleBitmap(dc, width, height);
    if (!replacement) return;
    if (weatherPanelCache_.bitmap) DeleteObject(weatherPanelCache_.bitmap);
    weatherPanelCache_.bitmap = replacement;
    weatherPanelCache_.width = width;
    weatherPanelCache_.height = height;
  }
  HDC target = BitmapMemoryDc(dc);
  if (!target) return;
  HGDIOBJ previous = SelectObject(target, weatherPanelCache_.bitmap);
  if (!previous || previous == HGDI_ERROR) return;
  const BOOL copied = BitBlt(target, 0, 0, width, height, dc, card.left, card.top, SRCCOPY);
  SelectObject(target, previous);
  if (!copied) return;
  weatherPanelCache_.revision = nativeDashboard_.revisions.weather;
  weatherPanelCache_.outage = nativeDashboard_.weatherOutage;
}

HBITMAP Renderer::NativeArtworkBitmap(const std::wstring& url, int width, int height) {
  if (url.empty() || width <= 0 || height <= 0) return nullptr;
  static constexpr wchar_t kDataHostPrefix[] = L"https://data.homepanel/";
  if (url.rfind(kDataHostPrefix, 0) != 0) return nullptr;
  const std::wstring key = url + L"#" + std::to_wstring(width) + L"x" + std::to_wstring(height);
  auto found = nativeImageBitmaps_.find(key);
  if (found != nativeImageBitmaps_.end()) {
    if (found->second.bitmap) {
      found->second.lastUsed = ++nativeImageUseCounter_;
      return found->second.bitmap;
    }
    if (UnixMillis() < static_cast<int64_t>(found->second.lastUsed)) return nullptr;
    nativeImageBitmaps_.erase(found);
  }
  std::wstring relative = url.substr(std::size(kDataHostPrefix) - 1);
  if (relative.empty() || relative.find(L"..") != std::wstring::npos) return nullptr;
  for (auto& character : relative) if (character == L'/') character = L'\\';
  return CacheNativeImageBitmap(key, DecodeImageFileToBitmap(dataDir_ / relative, width, height));
}

HBITMAP Renderer::NativeWeatherIconBitmap(
    const std::wstring& icon, bool night, int width, int height) {
  if (icon.empty() || width <= 0 || height <= 0) return nullptr;
  for (wchar_t character : icon) if (character < L'0' || character > L'9') return nullptr;
  const std::wstring fileName = icon + (night ? L"_night.png" : L"_day.png");
  const std::wstring key = fileName + L"#" + std::to_wstring(width) + L"x" + std::to_wstring(height);
  auto found = nativeWeatherIconBitmaps_.find(key);
  if (found != nativeWeatherIconBitmaps_.end()) {
    if (found->second.bitmap) {
      found->second.lastUsed = ++nativeWeatherIconUseCounter_;
      return found->second.bitmap;
    }
    if (UnixMillis() < static_cast<int64_t>(found->second.lastUsed)) return nullptr;
    nativeWeatherIconBitmaps_.erase(found);
  }
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
  return CacheNativeWeatherIconBitmap(key, bitmap);
}

HBITMAP Renderer::CacheNativeImageBitmap(const std::wstring& key, HBITMAP bitmap) {
  if (nativeImageBitmaps_.size() >= kNativeImageBitmapCacheLimit) {
    auto oldest = nativeImageBitmaps_.end();
    for (auto item = nativeImageBitmaps_.begin(); item != nativeImageBitmaps_.end(); ++item) {
      if (!item->second.bitmap) { oldest = item; break; }
      if (oldest == nativeImageBitmaps_.end() || item->second.lastUsed < oldest->second.lastUsed) oldest = item;
    }
    if (oldest != nativeImageBitmaps_.end()) {
      if (oldest->second.bitmap) DeleteObject(oldest->second.bitmap);
      nativeImageBitmaps_.erase(oldest);
    }
  }
  const uint64_t stamp = bitmap ? ++nativeImageUseCounter_
      : static_cast<uint64_t>(UnixMillis() + kNativeImageDecodeRetryMs);
  nativeImageBitmaps_[key] = BitmapCacheEntry{bitmap, stamp};
  return bitmap;
}

HBITMAP Renderer::CacheNativeWeatherIconBitmap(const std::wstring& key, HBITMAP bitmap) {
  if (nativeWeatherIconBitmaps_.size() >= kWeatherIconBitmapCacheLimit) {
    auto oldest = nativeWeatherIconBitmaps_.end();
    for (auto item = nativeWeatherIconBitmaps_.begin(); item != nativeWeatherIconBitmaps_.end(); ++item) {
      if (!item->second.bitmap) { oldest = item; break; }
      if (oldest == nativeWeatherIconBitmaps_.end() || item->second.lastUsed < oldest->second.lastUsed) oldest = item;
    }
    if (oldest != nativeWeatherIconBitmaps_.end()) {
      if (oldest->second.bitmap) DeleteObject(oldest->second.bitmap);
      nativeWeatherIconBitmaps_.erase(oldest);
    }
  }
  const uint64_t stamp = bitmap ? ++nativeWeatherIconUseCounter_
      : static_cast<uint64_t>(UnixMillis() + kNativeImageDecodeRetryMs);
  nativeWeatherIconBitmaps_[key] = BitmapCacheEntry{bitmap, stamp};
  return bitmap;
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
  if (weatherPanelCache_.bitmap) DeleteObject(weatherPanelCache_.bitmap);
  weatherPanelCache_ = {};
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
