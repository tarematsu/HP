#pragma once
#include "common.h"

namespace hp {
class SharedWebViewEnvironment {
 public:
  using Completion = std::function<void(HRESULT, ICoreWebView2Environment*)>;

  static SharedWebViewEnvironment& Instance();
  void Acquire(const fs::path& userDataFolder, Completion completion);
  void Invalidate(const fs::path& userDataFolder);

 private:
  struct Entry {
    fs::path userDataFolder;
    ComPtr<ICoreWebView2Environment> environment;
    std::vector<Completion> pending;
    uint32_t acquireCount = 0;
    uint64_t generation = 0;
    bool creating = false;
  };

  SharedWebViewEnvironment() = default;
  void Complete(const std::wstring& key, uint64_t generation, HRESULT result,
                ICoreWebView2Environment* environment);
  static std::wstring NormalizePath(const fs::path& path);

  std::mutex mutex_;
  std::map<std::wstring, Entry> entries_;
};
}
