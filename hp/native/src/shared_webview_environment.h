#pragma once
#include "common.h"

namespace hp {
class SharedWebViewEnvironment {
 public:
  using Completion = std::function<void(HRESULT, ICoreWebView2Environment*)>;

  static SharedWebViewEnvironment& Instance();
  // The single Stationhead player reuses the same WebView2 user-data folder as
  // Spotify/YouTube/TVer. A user-data folder can have only one environment
  // policy, so Stationhead joins the full-resource environment and keeps its
  // image/font reductions at the per-WebView request-filter layer.
  void Acquire(const fs::path& userDataFolder, Completion completion) {
    Acquire(userDataFolder, false, false, std::move(completion));
  }
  void Acquire(const fs::path& userDataFolder, bool blockImages,
               bool blockFonts, Completion completion);
  void Invalidate(const fs::path& userDataFolder);

 private:
  struct Entry {
    fs::path userDataFolder;
    ComPtr<ICoreWebView2Environment> environment;
    std::vector<Completion> pending;
    uint32_t acquireCount = 0;
    uint64_t generation = 0;
    bool creating = false;
    bool blockImages = false;
    bool blockFonts = false;
  };

  SharedWebViewEnvironment() = default;
  void Complete(const std::wstring& key, uint64_t generation, HRESULT result,
                ICoreWebView2Environment* environment);
  static std::wstring NormalizePath(const fs::path& path);

  std::mutex mutex_;
  std::map<std::wstring, Entry> entries_;
};
}  // namespace hp
