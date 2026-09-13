#pragma once

#include "common.h"

#include <condition_variable>
#include <functional>
#include <memory>
#include <mutex>
#include <string>
#include <unordered_map>
#include <vector>

namespace hp {

// Small process-wide coordinator for native control-plane GETs.
//
// It deliberately does not touch WebView/media traffic. Callers provide the
// actual network operation, while this class only coalesces identical in-flight
// requests, serves a short-lived successful result, and applies a shared retry
// backoff after failures. This keeps independent panels from opening duplicate
// connections for the same control resource.
struct CoordinatedNetworkResult {
  bool ok = false;
  std::vector<uint8_t> body;
  std::wstring error;
};

class NetworkRequestCoordinator final {
 public:
  using Loader = std::function<CoordinatedNetworkResult()>;

  static CoordinatedNetworkResult Run(const std::wstring& key,
                                      ULONGLONG successTtlMs,
                                      ULONGLONG failureBackoffMs,
                                      Loader loader) {
    if (key.empty() || !loader) return LoadSafely(std::move(loader));

    State& state = SharedState();
    std::shared_ptr<Entry> entry;
    {
      std::unique_lock lock(state.mutex);
      auto [it, inserted] = state.entries.try_emplace(key);
      if (inserted || !it->second) it->second = std::make_shared<Entry>();
      entry = it->second;

      while (entry->inFlight) entry->ready.wait(lock);

      const ULONGLONG now = GetTickCount64();
      if (entry->hasResult) {
        const ULONGLONG validUntil = entry->result.ok
            ? entry->successUntil
            : entry->failureUntil;
        if (validUntil != 0 && now < validUntil) return entry->result;
      }
      entry->inFlight = true;
      PruneExpiredLocked(state, now, entry.get());
    }

    CoordinatedNetworkResult result = LoadSafely(std::move(loader));
    {
      std::lock_guard lock(state.mutex);
      const ULONGLONG now = GetTickCount64();
      entry->result = result;
      entry->hasResult = true;
      entry->successUntil = result.ok && successTtlMs
          ? SaturatingAdd(now, successTtlMs)
          : 0;
      entry->failureUntil = !result.ok && failureBackoffMs
          ? SaturatingAdd(now, failureBackoffMs)
          : 0;
      entry->inFlight = false;
    }
    entry->ready.notify_all();
    return result;
  }

 private:
  struct Entry {
    std::condition_variable ready;
    bool inFlight = false;
    bool hasResult = false;
    ULONGLONG successUntil = 0;
    ULONGLONG failureUntil = 0;
    CoordinatedNetworkResult result;
  };

  struct State {
    std::mutex mutex;
    std::unordered_map<std::wstring, std::shared_ptr<Entry>> entries;
  };

  static State& SharedState() noexcept {
    static State state;
    return state;
  }

  static ULONGLONG SaturatingAdd(ULONGLONG value, ULONGLONG delta) noexcept {
    const ULONGLONG maximum = std::numeric_limits<ULONGLONG>::max();
    return delta > maximum - value ? maximum : value + delta;
  }

  static CoordinatedNetworkResult LoadSafely(Loader loader) noexcept {
    if (!loader) {
      CoordinatedNetworkResult result;
      result.error = L"network loader missing";
      return result;
    }
    try {
      return loader();
    } catch (const std::exception& error) {
      CoordinatedNetworkResult result;
      result.error = Utf8ToWide(error.what());
      if (result.error.empty()) result.error = L"network request failed";
      return result;
    } catch (...) {
      CoordinatedNetworkResult result;
      result.error = L"network request failed";
      return result;
    }
  }

  static void PruneExpiredLocked(State& state, ULONGLONG now,
                                 const Entry* keep) {
    if (state.entries.size() <= 64) return;
    for (auto it = state.entries.begin(); it != state.entries.end();) {
      const std::shared_ptr<Entry>& candidate = it->second;
      if (!candidate || candidate.get() == keep || candidate->inFlight) {
        ++it;
        continue;
      }
      const ULONGLONG validUntil = candidate->result.ok
          ? candidate->successUntil
          : candidate->failureUntil;
      if (!candidate->hasResult || validUntil == 0 || now >= validUntil) {
        it = state.entries.erase(it);
      } else {
        ++it;
      }
    }
  }
};

}  // namespace hp
