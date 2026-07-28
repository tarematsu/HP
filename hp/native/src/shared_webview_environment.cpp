#include "shared_webview_environment.h"
#include <WebView2EnvironmentOptions.h>

namespace hp {
namespace {

constexpr wchar_t kBaseWebView2Arguments[] =
    L"--disable-domain-reliability "
    L"--disable-breakpad "
    L"--disable-extensions "
    L"--disable-sync "
    L"--metrics-recording-only "
    L"--autoplay-policy=no-user-gesture-required "
    // Stationhead startup, track-boundary refreshes, and WebView rebuilds must
    // all be genuine network navigations. Disable Chromium's HTTP cache and its
    // back/forward page-state cache while retaining the persistent profile,
    // cookies, DOM storage, Spotify login, and DRM/session state.
    L"--disable-http-cache "
    L"--disable-backgrounding-occluded-windows "
    L"--disable-features=BackForwardCache,MediaRouter,Translate,OptimizationGuideModelDownloading,AutofillServerCommunication,HardwareSecureDecryption,HardwareSecureDecryptionExperiment";

std::wstring BuildWebView2Arguments(bool blockImages, bool blockFonts) {
  std::wstring arguments = kBaseWebView2Arguments;
  if (!blockImages && !blockFonts) return arguments;

  arguments += L" --blink-settings=";
  bool needsSeparator = false;
  if (blockImages) {
    // imagesEnabled=false prevents cached images from being decoded/rendered;
    // loadsImagesAutomatically=false prevents URL-backed image downloads.
    arguments += L"imagesEnabled=false,loadsImagesAutomatically=false";
    needsSeparator = true;
  }
  if (blockFonts) {
    if (needsSeparator) arguments += L',';
    arguments += L"downloadableBinaryFontsEnabled=false";
  }
  return arguments;
}

void ApplyWebView2ProcessHints() {
  static std::once_flag once;
  std::call_once(once, [] {
    // Keep only process-wide, configuration-independent switches here. The
    // image/font Blink policy is supplied through environment options below.
    SetEnvironmentVariableW(L"WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
                            kBaseWebView2Arguments);
  });
}

void InvokeEnvironmentCompletionNoexcept(
    SharedWebViewEnvironment::Completion& completion,
    HRESULT result,
    ICoreWebView2Environment* environment) noexcept {
  if (!completion) return;
  try {
    completion(result, environment);
  } catch (...) {
    // A and B share one environment creation. A failing consumer callback must
    // never unwind through WebView2 or prevent the remaining pending consumer
    // from receiving the same completion. Its own creation watchdog will
    // recover the failed instance.
  }
}
}  // namespace

SharedWebViewEnvironment& SharedWebViewEnvironment::Instance() {
  static SharedWebViewEnvironment instance;
  return instance;
}

std::wstring SharedWebViewEnvironment::NormalizePath(const fs::path& path) {
  std::error_code error;
  fs::path normalized = fs::absolute(path, error);
  if (error) normalized = path;
  normalized = normalized.lexically_normal();
  std::wstring key = normalized.wstring();
  std::transform(key.begin(), key.end(), key.begin(), towlower);
  return key;
}

void SharedWebViewEnvironment::Acquire(const fs::path& userDataFolder,
                                       bool blockImages,
                                       bool blockFonts,
                                       Completion completion) {
  if (!completion) return;

  std::wstring requestedKey;
  ComPtr<ICoreWebView2Environment> readyEnvironment;
  bool startCreation = false;
  bool policyMismatch = false;
  bool blockImagesForCreation = false;
  bool blockFontsForCreation = false;
  uint64_t creationGeneration = 0;
  fs::path folderForCreation;

  try {
    requestedKey = NormalizePath(userDataFolder);
    {
      std::lock_guard lock(mutex_);
      Entry& entry = entries_[requestedKey];
      if (entry.acquireCount == 0) {
        entry.userDataFolder = userDataFolder;
        entry.blockImages = blockImages;
        entry.blockFonts = blockFonts;
      } else if (entry.blockImages != blockImages ||
                 entry.blockFonts != blockFonts) {
        // One user-data folder maps to one browser environment. Mixing resource
        // policies would silently make A and B behave differently depending on
        // which asynchronous Acquire won the race.
        policyMismatch = true;
      }
      if (!policyMismatch) {
        ++entry.acquireCount;
        if (entry.environment) {
          readyEnvironment = entry.environment;
        } else {
          const bool beginCreation = !entry.creating;
          // Copy every potentially allocating value before publishing the pending
          // callback or the creating flag. An allocation failure cannot leave a
          // queued callback behind an environment generation that never starts.
          fs::path preparedFolder;
          if (beginCreation) preparedFolder = entry.userDataFolder;
          entry.pending.push_back(std::move(completion));
          if (beginCreation) {
            entry.creating = true;
            creationGeneration = ++entry.generation;
            startCreation = true;
            folderForCreation = std::move(preparedFolder);
            blockImagesForCreation = entry.blockImages;
            blockFontsForCreation = entry.blockFonts;
          }
        }
      }
    }
  } catch (const std::bad_alloc&) {
    InvokeEnvironmentCompletionNoexcept(completion, E_OUTOFMEMORY, nullptr);
    return;
  } catch (...) {
    InvokeEnvironmentCompletionNoexcept(completion, E_FAIL, nullptr);
    return;
  }

  if (policyMismatch) {
    InvokeEnvironmentCompletionNoexcept(completion, E_INVALIDARG, nullptr);
    return;
  }
  if (readyEnvironment) {
    InvokeEnvironmentCompletionNoexcept(
        completion, S_OK, readyEnvironment.Get());
    return;
  }
  if (!startCreation) return;

  try {
    std::error_code directoryError;
    fs::create_directories(folderForCreation, directoryError);
    if (directoryError) {
      Complete(requestedKey, creationGeneration,
               HRESULT_FROM_WIN32(directoryError.value()), nullptr);
      return;
    }

    ApplyWebView2ProcessHints();
    const std::wstring webView2Arguments = BuildWebView2Arguments(
        blockImagesForCreation, blockFontsForCreation);
    ComPtr<CoreWebView2EnvironmentOptions> options =
        Microsoft::WRL::Make<CoreWebView2EnvironmentOptions>();
    if (options) {
      options->put_AdditionalBrowserArguments(webView2Arguments.c_str());
    }
    const auto key = std::make_shared<std::wstring>(requestedKey);
    const HRESULT started = CreateCoreWebView2EnvironmentWithOptions(
        nullptr, folderForCreation.c_str(), options.Get(),
        Callback<ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler>(
            [this, key, creationGeneration](
                HRESULT result, ICoreWebView2Environment* environment) -> HRESULT {
              Complete(*key, creationGeneration,
                       FAILED(result) || !environment
                           ? (FAILED(result) ? result : E_POINTER)
                           : S_OK,
                       environment);
              return S_OK;
            }).Get());
    if (FAILED(started)) {
      Complete(requestedKey, creationGeneration, started, nullptr);
    }
  } catch (const std::bad_alloc&) {
    Complete(requestedKey, creationGeneration, E_OUTOFMEMORY, nullptr);
  } catch (...) {
    Complete(requestedKey, creationGeneration, E_FAIL, nullptr);
  }
}

void SharedWebViewEnvironment::Invalidate(const fs::path& userDataFolder) {
  const std::wstring key = NormalizePath(userDataFolder);
  std::vector<Completion> callbacks;
  {
    std::lock_guard lock(mutex_);
    auto iterator = entries_.find(key);
    if (iterator == entries_.end()) return;
    Entry& entry = iterator->second;
    // A and B share this environment but create independent profile
    // controllers. A timeout after the environment is already ready belongs to
    // that one controller; clearing the shared cache here can make the healthy
    // peer create a second environment against the same user-data folder.
    // Invalidate only an environment creation that is still genuinely pending.
    if (entry.environment) return;
    ++entry.generation;
    entry.creating = false;
    callbacks.swap(entry.pending);
  }
  const HRESULT timeout = HRESULT_FROM_WIN32(ERROR_TIMEOUT);
  for (auto& callback : callbacks) {
    InvokeEnvironmentCompletionNoexcept(callback, timeout, nullptr);
  }
}

void SharedWebViewEnvironment::Complete(const std::wstring& key,
                                        uint64_t generation, HRESULT result,
                                        ICoreWebView2Environment* environment) {
  std::vector<Completion> callbacks;
  ComPtr<ICoreWebView2Environment> readyEnvironment;
  {
    std::lock_guard lock(mutex_);
    auto iterator = entries_.find(key);
    if (iterator == entries_.end()) return;
    Entry& entry = iterator->second;
    if (entry.generation != generation) return;
    // Close this generation before invoking consumers. A duplicate or delayed
    // COM completion for the same creation cannot overwrite the accepted
    // environment or deliver the pending callbacks twice.
    ++entry.generation;
    entry.creating = false;
    if (SUCCEEDED(result) && environment) {
      entry.environment = environment;
      readyEnvironment = entry.environment;
    }
    callbacks.swap(entry.pending);
  }

  for (auto& callback : callbacks) {
    InvokeEnvironmentCompletionNoexcept(
        callback, result, readyEnvironment.Get());
  }
}
}  // namespace hp
