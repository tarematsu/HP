#include "shared_webview_environment.h"
#include <WebView2EnvironmentOptions.h>

namespace hp {
namespace {

// Keep autoplay enabled and keep background timers running. Renderer/window
// backgrounding still follows Chromium's default policy.
constexpr wchar_t kSharedWebView2LifecycleArguments[] =
    L"--autoplay-policy=no-user-gesture-required "
    L"--disable-background-timer-throttling "
    L"--disable-domain-reliability "
    L"--disable-breakpad "
    L"--disable-extensions "
    L"--disable-sync "
    L"--metrics-recording-only";

// Keep media/DRM plumbing intact for YouTube, TVer, Spotify and Stationhead
// while turning off browser subsystems unrelated to playback.
constexpr wchar_t kFullResourceWebView2Arguments[] =
    L"--disable-features=BackForward"
    L"Cache,MediaRouter,Translate,OptimizationGuideModelDownloading,AutofillServerCommunication";

// Retain the historical symbol because tests and policy code distinguish the
// reduced-resource path, but keep it DRM-safe now that the same UDF policy is
// shared by Stationhead, Spotify, YouTube and TVer.
constexpr wchar_t kStationheadWebView2Arguments[] =
    L"--disable-features=BackForwardCache,MediaRouter,Translate,OptimizationGuideModelDownloading,AutofillServerCommunication";

constexpr ULONGLONG kSharedBrowserRecycleCooldownMs = 10ULL * 60ULL * 1000ULL;
constexpr UINT kSharedBrowserRecycleExitCode = 0xE0420001U;

std::wstring BuildWebView2Arguments(bool blockImages, bool blockFonts) {
  if (!blockImages && !blockFonts) return kFullResourceWebView2Arguments;

  std::wstring arguments = kStationheadWebView2Arguments;
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

  // The media panel has its own UDF, so it can suppress non-playback images
  // and downloadable fonts without affecting Stationhead/Spotify auth flows.
  // Other shared playback UDFs keep images available for login/reCAPTCHA.
  const std::wstring folderName = userDataFolder.filename().wstring();
  const bool mediaUdf =
      _wcsicmp(folderName.c_str(), L"webview2-youtube-mv") == 0;
  blockImages = mediaUdf;
  blockFonts = true;

  std::wstring requestedKey;
  ComPtr<ICoreWebView2Environment> readyEnvironment;
  bool startCreation = false;
  bool policyMismatch = false;
  bool recycleBlocked = false;
  bool blockImagesForCreation = false;
  bool blockFontsForCreation = false;
  uint64_t creationGeneration = 0;
  fs::path folderForCreation;

  try {
    requestedKey = NormalizePath(userDataFolder);
    {
      std::lock_guard lock(mutex_);
      Entry& entry = entries_[requestedKey];
      recycleBlocked = entry.recyclePending;
      if (!recycleBlocked) {
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
    }
  } catch (const std::bad_alloc&) {
    InvokeEnvironmentCompletionNoexcept(completion, E_OUTOFMEMORY, nullptr);
    return;
  } catch (...) {
    InvokeEnvironmentCompletionNoexcept(completion, E_FAIL, nullptr);
    return;
  }

  if (recycleBlocked) {
    InvokeEnvironmentCompletionNoexcept(
        completion, HRESULT_FROM_WIN32(ERROR_RETRY), nullptr);
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

    std::wstring webView2Arguments = kSharedWebView2LifecycleArguments;
    const std::wstring resourceArguments = BuildWebView2Arguments(
        blockImagesForCreation, blockFontsForCreation);
    if (!resourceArguments.empty()) {
      webView2Arguments += L" ";
      webView2Arguments += resourceArguments;
    }
    ComPtr<CoreWebView2EnvironmentOptions> options =
        Microsoft::WRL::Make<CoreWebView2EnvironmentOptions>();
    if (options && !webView2Arguments.empty()) {
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
    if (entry.environment || entry.recyclePending) return;
    ++entry.generation;
    entry.creating = false;
    callbacks.swap(entry.pending);
  }
  const HRESULT timeout = HRESULT_FROM_WIN32(ERROR_TIMEOUT);
  for (auto& callback : callbacks) {
    InvokeEnvironmentCompletionNoexcept(callback, timeout, nullptr);
  }
}

bool SharedWebViewEnvironment::RecycleBrowserProcess(
    const fs::path& userDataFolder, ICoreWebView2* webview) noexcept {
  if (!webview) return false;

  UINT32 browserProcessId = 0;
  if (FAILED(webview->get_BrowserProcessId(&browserProcessId)) ||
      browserProcessId == 0 || browserProcessId == GetCurrentProcessId()) {
    return false;
  }

  std::wstring key;
  try {
    key = NormalizePath(userDataFolder);
  } catch (...) {
    return false;
  }

  const ULONGLONG now = GetTickCount64();
  ULONGLONG recycleStartedTick = 0;
  {
    std::lock_guard lock(mutex_);
    auto iterator = entries_.find(key);
    if (iterator == entries_.end()) return false;
    Entry& entry = iterator->second;
    if (entry.recyclePending) return true;
    if (!entry.environment || entry.browserProcessExitedToken.value == 0) {
      return false;
    }
    if (entry.lastRecycleTick != 0 && now >= entry.lastRecycleTick &&
        now - entry.lastRecycleTick < kSharedBrowserRecycleCooldownMs) {
      return false;
    }
    entry.recyclePending = true;
    entry.recycleStartedTick = std::max<ULONGLONG>(1, now);
    entry.lastRecycleTick = entry.recycleStartedTick;
    recycleStartedTick = entry.recycleStartedTick;
  }

  HANDLE process = OpenProcess(PROCESS_TERMINATE | SYNCHRONIZE, FALSE,
                               browserProcessId);
  if (!process) {
    std::lock_guard lock(mutex_);
    auto iterator = entries_.find(key);
    if (iterator != entries_.end() &&
        iterator->second.recycleStartedTick == recycleStartedTick) {
      iterator->second.recyclePending = false;
      iterator->second.recycleStartedTick = 0;
    }
    return false;
  }

  const BOOL terminated = TerminateProcess(process, kSharedBrowserRecycleExitCode);
  CloseHandle(process);
  if (terminated) return true;

  std::lock_guard lock(mutex_);
  auto iterator = entries_.find(key);
  if (iterator != entries_.end() &&
      iterator->second.recycleStartedTick == recycleStartedTick) {
    iterator->second.recyclePending = false;
    iterator->second.recycleStartedTick = 0;
  }
  return false;
}

void SharedWebViewEnvironment::HandleBrowserProcessExited(
    const std::wstring& key, uint64_t environmentGeneration) noexcept {
  std::vector<Completion> callbacks;
  {
    std::lock_guard lock(mutex_);
    auto iterator = entries_.find(key);
    if (iterator == entries_.end()) return;
    Entry& entry = iterator->second;
    if (entry.generation != environmentGeneration) return;

    // BrowserProcessExited is the synchronization point at which the old
    // browser process has released the UDF. Only now may Acquire create a fresh
    // environment for the same folder.
    ++entry.generation;
    entry.environment.Reset();
    entry.browserProcessExitedToken = {};
    entry.creating = false;
    entry.recyclePending = false;
    entry.recycleStartedTick = 0;
    callbacks.swap(entry.pending);
  }

  for (auto& callback : callbacks) {
    InvokeEnvironmentCompletionNoexcept(callback, E_ABORT, nullptr);
  }
}

void SharedWebViewEnvironment::Complete(const std::wstring& key,
                                        uint64_t generation, HRESULT result,
                                        ICoreWebView2Environment* environment) {
  std::vector<Completion> callbacks;
  ComPtr<ICoreWebView2Environment> readyEnvironment;
  uint64_t environmentGeneration = 0;
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
      environmentGeneration = entry.generation;
    }
    callbacks.swap(entry.pending);
  }

  if (readyEnvironment) {
    ComPtr<ICoreWebView2Environment5> environment5;
    if (SUCCEEDED(readyEnvironment.As(&environment5)) && environment5) {
      const auto keyCopy = std::make_shared<std::wstring>(key);
      EventRegistrationToken token{};
      const HRESULT registered = environment5->add_BrowserProcessExited(
          Callback<ICoreWebView2BrowserProcessExitedEventHandler>(
              [this, keyCopy, environmentGeneration](
                  ICoreWebView2Environment*,
                  ICoreWebView2BrowserProcessExitedEventArgs*) -> HRESULT {
                HandleBrowserProcessExited(*keyCopy, environmentGeneration);
                return S_OK;
              }).Get(),
          &token);
      if (SUCCEEDED(registered)) {
        std::lock_guard lock(mutex_);
        auto iterator = entries_.find(key);
        if (iterator != entries_.end() &&
            iterator->second.generation == environmentGeneration &&
            iterator->second.environment.Get() == readyEnvironment.Get()) {
          iterator->second.browserProcessExitedToken = token;
        }
      }
    }
  }

  for (auto& callback : callbacks) {
    InvokeEnvironmentCompletionNoexcept(
        callback, result, readyEnvironment.Get());
  }
}
}  // namespace hp
