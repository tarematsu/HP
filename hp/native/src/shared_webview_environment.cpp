#include "shared_webview_environment.h"
#include <WebView2EnvironmentOptions.h>

namespace hp {
namespace {

// Playback surfaces must keep renderer timers and media plumbing fully active
// even while their host windows are parked behind the native UI. Disabling
// Chromium's occluded-window/background throttles avoids long-lived Spotify or
// Stationhead lanes drifting into a suspended renderer state while still
// looking healthy to the page UI.
constexpr wchar_t kSharedWebView2LifecycleArguments[] =
    L"--autoplay-policy=no-user-gesture-required "
    L"--disable-backgrounding-occluded-windows "
    L"--disable-renderer-backgrounding "
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

constexpr ULONGLONG kReadyInvalidationWindowMs = 5ULL * 60ULL * 1000ULL;
constexpr ULONGLONG kHardResetCooldownMs = 5ULL * 60ULL * 1000ULL;
constexpr uint32_t kReadyInvalidationThreshold = 3;

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

HRESULT TerminateSharedBrowserProcess(
    ICoreWebView2Environment* environment) noexcept {
  if (!environment) return E_POINTER;
  ComPtr<ICoreWebView2Environment8> environment8;
  if (FAILED(environment->QueryInterface(IID_PPV_ARGS(&environment8))) ||
      !environment8) {
    return E_NOINTERFACE;
  }

  ComPtr<ICoreWebView2ProcessInfoCollection> processes;
  HRESULT result = environment8->GetProcessInfos(&processes);
  if (FAILED(result) || !processes) return FAILED(result) ? result : E_FAIL;

  UINT32 count = 0;
  result = processes->get_Count(&count);
  if (FAILED(result)) return result;
  for (UINT32 index = 0; index < count; ++index) {
    ComPtr<ICoreWebView2ProcessInfo> process;
    if (FAILED(processes->GetValueAtIndex(index, &process)) || !process) {
      continue;
    }
    COREWEBVIEW2_PROCESS_KIND kind{};
    INT32 processId = 0;
    if (FAILED(process->get_Kind(&kind)) ||
        kind != COREWEBVIEW2_PROCESS_KIND_BROWSER ||
        FAILED(process->get_ProcessId(&processId)) || processId <= 0) {
      continue;
    }

    HANDLE handle = OpenProcess(PROCESS_TERMINATE, FALSE,
                                static_cast<DWORD>(processId));
    if (!handle) return HRESULT_FROM_WIN32(GetLastError());
    const BOOL terminated = TerminateProcess(handle, ERROR_PROCESS_ABORTED);
    const DWORD terminateError = terminated ? ERROR_SUCCESS : GetLastError();
    CloseHandle(handle);
    return terminated ? S_OK : HRESULT_FROM_WIN32(terminateError);
  }
  return HRESULT_FROM_WIN32(ERROR_NOT_FOUND);
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

  // All current playback surfaces intentionally share one UDF. Normalize every
  // caller to the same environment-level policy so whichever component starts
  // first cannot accidentally create an unrestricted environment for the rest.
  blockImages = true;
  blockFonts = true;

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
  ComPtr<ICoreWebView2Environment> environmentToReset;
  {
    std::lock_guard lock(mutex_);
    auto iterator = entries_.find(key);
    if (iterator == entries_.end()) return;
    Entry& entry = iterator->second;
    if (entry.environment) {
      // A single controller timeout against an otherwise healthy shared
      // environment must not tear down Spotify/Stationhead/YouTube/TVer. Treat
      // repeated ready-environment invalidations as strikes and escalate only
      // after three failures in a five-minute window.
      const ULONGLONG now = GetTickCount64();
      if (entry.firstReadyInvalidationTick == 0 ||
          now < entry.firstReadyInvalidationTick ||
          now - entry.firstReadyInvalidationTick > kReadyInvalidationWindowMs) {
        entry.firstReadyInvalidationTick = now;
        entry.readyInvalidationStrikes = 1;
        return;
      }
      if (entry.readyInvalidationStrikes < UINT32_MAX) {
        ++entry.readyInvalidationStrikes;
      }
      if (entry.readyInvalidationStrikes < kReadyInvalidationThreshold) return;
      if (entry.lastHardResetTick != 0 && now >= entry.lastHardResetTick &&
          now - entry.lastHardResetTick < kHardResetCooldownMs) {
        entry.readyInvalidationStrikes = 0;
        entry.firstReadyInvalidationTick = 0;
        return;
      }

      environmentToReset = entry.environment;
      entry.environment.Reset();
      entry.lastHardResetTick = now;
      entry.readyInvalidationStrikes = 0;
      entry.firstReadyInvalidationTick = 0;
      ++entry.generation;
      entry.creating = false;
      callbacks.swap(entry.pending);
    } else {
      // Environment creation itself is still pending. Cancel that generation as
      // before and let the next Acquire start a new one.
      ++entry.generation;
      entry.creating = false;
      callbacks.swap(entry.pending);
    }
  }

  if (environmentToReset) {
    // Dropping the cached COM reference alone is insufficient while controllers
    // still own the browser process. Terminating only the browser process is the
    // final escalation: WebView2 tears down its children, existing ProcessFailed
    // handlers rebuild their surfaces, and the next Acquire creates a genuinely
    // fresh environment against the same persistent profiles.
    TerminateSharedBrowserProcess(environmentToReset.Get());
  }

  const HRESULT retry = environmentToReset
      ? HRESULT_FROM_WIN32(ERROR_RETRY)
      : HRESULT_FROM_WIN32(ERROR_TIMEOUT);
  for (auto& callback : callbacks) {
    InvokeEnvironmentCompletionNoexcept(callback, retry, nullptr);
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
      entry.readyInvalidationStrikes = 0;
      entry.firstReadyInvalidationTick = 0;
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
