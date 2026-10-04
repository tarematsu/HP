#pragma once

#include "common.h"

// HomePanelUpdater historically wrote a separate text log through
// std::wofstream. The updater still needs ordinary file I/O for manifests,
// staging and verified installation, but diagnostic text files are disabled.
namespace std {
class HomePanelNullWideOutputStream final {
 public:
  template <typename... Args>
  explicit HomePanelNullWideOutputStream(Args&&...) noexcept {}

  template <typename T>
  HomePanelNullWideOutputStream& operator<<(T&&) noexcept {
    return *this;
  }
};
}  // namespace std

#define wofstream HomePanelNullWideOutputStream
