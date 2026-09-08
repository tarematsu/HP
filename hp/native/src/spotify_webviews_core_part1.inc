#include "spotify_webviews.h"
#include "shared_webview_environment.h"

namespace hp {
namespace {
constexpr wchar_t kSpotifyHostClass[] = L"HomePanelSpotifyWebView";
constexpr wchar_t kSpotifyPlaylistUrl[] =
    L"https://open.spotify.com/album/2f2Ik9JeinFVWZuFb3i35b";
constexpr wchar_t kSpotifyPodcastUrl[] =
    L"https://open.spotify.com/show/2ZQy2mlwQodabAILwZ02Ed";
constexpr wchar_t kSpotifyLoginUrl[] =
    L"https://accounts.spotify.com/login?continue=https%3A%2F%2Fopen.spotify.com%2Falbum%2F2f2Ik9JeinFVWZuFb3i35b";
constexpr wchar_t kSpotifyProfilePrefix[] = L"spotify-";

void SetSpotifyOutputMuted(const ComPtr<ICoreWebView2>& webview) noexcept {
  if (!webview) return;
  ComPtr<ICoreWebView2_8> audio;
  if (SUCCEEDED(webview.As(&audio)) && audio) {
    audio->put_IsMuted(TRUE);
  }
}

bool StartsWithInsensitive(std::wstring_view value,
                           std::wstring_view prefix) noexcept {
  if (value.size() < prefix.size()) return false;
  for (size_t i = 0; i < prefix.size(); ++i) {
    if (towlower(value[i]) != towlower(prefix[i])) return false;
  }
  return true;
}
}  // namespace

SpotifyWebViews::SpotifyWebViews(HWND parentWindow, fs::path dataDir)
    : parentWindow_(parentWindow),
      // One UDF keeps the browser process family shared. Named profiles below
      // isolate cookies/local storage for every Spotify account.
      userDataFolder_(std::move(dataDir) / L"webview2-youtube-mv") {
  for (size_t i = 0; i < slots_.size(); ++i) {
    slots_[i].owner = this;
    slots_[i].index = i;
  }
}

SpotifyWebViews::~SpotifyWebViews() { Shutdown(); }

bool SpotifyWebViews::EnsureHostClass() noexcept {
  static std::once_flag once;
  static bool registered = false;
  try {
    std::call_once(once, [] {
      WNDCLASSW windowClass{};
      windowClass.lpfnWndProc = &SpotifyWebViews::HostWndProc;
      windowClass.hInstance = GetModuleHandleW(nullptr);
      windowClass.lpszClassName = kSpotifyHostClass;
      windowClass.hCursor = LoadCursorW(nullptr, IDC_ARROW);
      windowClass.hbrBackground =
          static_cast<HBRUSH>(GetStockObject(BLACK_BRUSH));
      SetLastError(ERROR_SUCCESS);
      registered = RegisterClassW(&windowClass) != 0 ||
                   GetLastError() == ERROR_CLASS_ALREADY_EXISTS;
    });
  } catch (...) {
    return false;
  }
  return registered;
}

bool SpotifyWebViews::CreateHost(Slot& slot) noexcept {
  if (slot.hostWindow && IsWindow(slot.hostWindow)) return true;
  if (!parentWindow_ || !IsWindow(parentWindow_) || !EnsureHostClass()) return false;
  slot.hostWindow = CreateWindowExW(
      0, kSpotifyHostClass, L"Spotify", WS_CHILD | WS_CLIPSIBLINGS,
      0, 0, 1, 1, parentWindow_, nullptr, GetModuleHandleW(nullptr), &slot);
  return slot.hostWindow && IsWindow(slot.hostWindow);
}

void SpotifyWebViews::Start() noexcept {
  if (started_ || !parentWindow_ || !IsWindow(parentWindow_)) return;
  started_ = true;
  podcastMode_ = false;
  robustSchedulerStarted_ = false;
  staggerSlotIndex_ = 0;
  staggerSlotStartTick_ = 0;
  youtubeCycleStartTick_ = 0;
  staggerSlotValidated_ = false;
  hostLayoutMask_ = ~0u;
  hostLayoutActiveSlot_ = kAccountCount;
  hostLayoutAuthenticationSlot_ = kAccountCount;
  alive_->store(true, std::memory_order_release);

  for (Slot& slot : slots_) {
    slot.state = SlotState::NotCreated;
    slot.unhealthySinceTick = 0;
    slot.targetGeneration = 0;
    slot.playerPage = false;
    slot.loginPage = false;
    slot.timedObserverReady = false;
    slot.timedObserverInstallInFlight = false;
    slot.controllerCreating = false;
    slot.controllerCreateTick = 0;
    if (!CreateHost(slot)) continue;
  }

  // Controller creation is serialized. Slot 0 starts immediately; the single
  // scheduler creates slots 1-5 when their 40-second turn arrives.
  if (!slots_.empty() && slots_[0].hostWindow) {
    CreateController(slots_[0]);
  }
  Resize();
}

void SpotifyWebViews::CreateController(Slot& slot) noexcept {
  if (!slot.hostWindow || !IsWindow(slot.hostWindow) ||
      slot.controller || slot.webview) {
    return;
  }
  SetSlotState(slot, SlotState::NotCreated);
  slot.controllerCreating = true;
  slot.controllerCreateTick = GetTickCount64();
  const auto alive = alive_;
  Slot* const target = &slot;
  try {
    SharedWebViewEnvironment::Instance().Acquire(
        userDataFolder_, false, false,
        [this, alive, target](HRESULT result,
                              ICoreWebView2Environment* environment) {
          if (!alive->load(std::memory_order_acquire)) return;
          if (FAILED(result) || !environment || !target->hostWindow ||
              !IsWindow(target->hostWindow)) {
            target->controllerCreating = false;
            target->controllerCreateTick = 0;
            MarkSlotRecovering(*target, GetTickCount64());
            return;
          }
          target->environment = environment;

          ComPtr<ICoreWebView2Environment10> environment10;
          if (FAILED(environment->QueryInterface(IID_PPV_ARGS(&environment10))) ||
              !environment10) {
            target->controllerCreating = false;
            target->controllerCreateTick = 0;
            MarkSlotRecovering(*target, GetTickCount64());
            return;
          }
