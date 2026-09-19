namespace hp {
namespace {

constexpr size_t kSpotifyCdpPlayerEvidenceLimit = 8;

struct SpotifyCdpPlayerEvidence {
  std::wstring playerId;
  bool audioDecoder = false;
  bool audioTracks = false;
};

struct SpotifyMediaStartEvidenceState {
  ICoreWebView2* webview = nullptr;
  ComPtr<ICoreWebView2DevToolsProtocolEventReceiver> propertiesReceiver;
  EventRegistrationToken propertiesToken{};
  ComPtr<ICoreWebView2DevToolsProtocolEventReceiver> eventsReceiver;
  EventRegistrationToken eventsToken{};
  std::vector<SpotifyCdpPlayerEvidence> players;
  std::wstring playbackPlayerId;
  ULONGLONG eventSequence = 0;
  ULONGLONG playbackEventSequence = 0;
  ULONGLONG targetBaselineSequence = 0;
  ULONGLONG targetGeneration = 0;
  bool registered = false;
};

std::array<SpotifyMediaStartEvidenceState, kSpotifyActiveAccountCount>
    gSpotifyMediaStartEvidence{};

bool SpotifyCdpContainsInsensitive(
    std::wstring_view value, std::wstring_view token) noexcept {
  if (token.empty() || value.size() < token.size()) return false;
  for (size_t start = 0; start + token.size() <= value.size(); ++start) {
    bool match = true;
    for (size_t offset = 0; offset < token.size(); ++offset) {
      if (towlower(value[start + offset]) != towlower(token[offset])) {
        match = false;
        break;
      }
    }
    if (match) return true;
  }
  return false;
}

std::wstring SpotifyCdpString(
    const winrt::Windows::Data::Json::JsonObject& object,
    std::wstring_view key) {
  using namespace winrt::Windows::Data::Json;
  if (!object.HasKey(key)) return {};
  const IJsonValue value = object.GetNamedValue(key);
  if (!value || value.ValueType() != JsonValueType::String) return {};
  return value.GetString().c_str();
}

bool SpotifyCdpPropertyValuePresent(
    const winrt::Windows::Data::Json::JsonObject& property) {
  using namespace winrt::Windows::Data::Json;
  if (!property.HasKey(L"value")) return false;
  const IJsonValue value = property.GetNamedValue(L"value");
  if (!value || value.ValueType() == JsonValueType::Null) return false;

  std::wstring text;
  if (value.ValueType() == JsonValueType::String) {
    text = value.GetString().c_str();
  } else {
    text = value.Stringify().c_str();
  }
  const auto first = std::find_if_not(
      text.begin(), text.end(), [](wchar_t ch) { return iswspace(ch) != 0; });
  const auto last = std::find_if_not(
      text.rbegin(), text.rend(), [](wchar_t ch) { return iswspace(ch) != 0; })
                        .base();
  if (first >= last) return false;
  const std::wstring_view trimmed(&*first, static_cast<size_t>(last - first));
  return !SpotifyCdpContainsInsensitive(trimmed, L"null") &&
         trimmed != L"[]" && trimmed != L"\"\"";
}

std::wstring SpotifyCdpEventParameters(
    ICoreWebView2DevToolsProtocolEventReceivedEventArgs* args) {
  if (!args) return {};
  LPWSTR raw = nullptr;
  if (FAILED(args->get_ParameterObjectAsJson(&raw)) || !raw) return {};
  std::wstring value(raw);
  CoTaskMemFree(raw);
  constexpr size_t kMaximumCharacters = 64 * 1024;
  if (value.size() > kMaximumCharacters) value.resize(kMaximumCharacters);
  return value;
}

SpotifyCdpPlayerEvidence* SpotifyFindPlayerEvidence(
    SpotifyMediaStartEvidenceState& state,
    std::wstring_view playerId,
    bool create) {
  if (playerId.empty()) return nullptr;
  for (auto& player : state.players) {
    if (player.playerId == playerId) return &player;
  }
  if (!create) return nullptr;
  if (state.players.size() >= kSpotifyCdpPlayerEvidenceLimit) {
    state.players.erase(state.players.begin());
  }
  state.players.push_back({std::wstring(playerId), false, false});
  return &state.players.back();
}

void SpotifyForgetPlayerEvidence(
    SpotifyMediaStartEvidenceState& state,
    std::wstring_view playerId) {
  if (playerId.empty()) return;
  state.players.erase(
      std::remove_if(
          state.players.begin(), state.players.end(),
          [playerId](const SpotifyCdpPlayerEvidence& player) {
            return player.playerId == playerId;
          }),
      state.players.end());
  if (state.playbackPlayerId == playerId) {
    state.playbackPlayerId.clear();
    state.playbackEventSequence = 0;
  }
}

void ReleaseSpotifyMediaStartEvidence(size_t accountIndex) noexcept {
  if (accountIndex >= gSpotifyMediaStartEvidence.size()) return;
  auto& state = gSpotifyMediaStartEvidence[accountIndex];
  if (state.propertiesReceiver && state.propertiesToken.value != 0) {
    state.propertiesReceiver->remove_DevToolsProtocolEventReceived(
        state.propertiesToken);
  }
  if (state.eventsReceiver && state.eventsToken.value != 0) {
    state.eventsReceiver->remove_DevToolsProtocolEventReceived(
        state.eventsToken);
  }
  state = {};
}

void ReleaseAllSpotifyMediaStartEvidence() noexcept {
  for (size_t index = 0; index < gSpotifyMediaStartEvidence.size(); ++index) {
    ReleaseSpotifyMediaStartEvidence(index);
  }
}

void BeginSpotifyMediaStartEvidenceGeneration(
    size_t accountIndex, ULONGLONG generation) noexcept {
  if (accountIndex >= gSpotifyMediaStartEvidence.size() || generation == 0) {
    return;
  }
  auto& state = gSpotifyMediaStartEvidence[accountIndex];
  if (state.targetGeneration == generation) return;
  state.targetGeneration = generation;
  state.targetBaselineSequence = state.eventSequence;
  state.playbackEventSequence = 0;
  state.playbackPlayerId.clear();
}

bool SpotifyMediaStartEvidenceReady(
    size_t accountIndex, ULONGLONG generation) noexcept {
  if (accountIndex >= gSpotifyMediaStartEvidence.size() || generation == 0) {
    return false;
  }
  auto& state = gSpotifyMediaStartEvidence[accountIndex];
  if (!state.registered || state.targetGeneration != generation ||
      state.playbackEventSequence <= state.targetBaselineSequence ||
      state.playbackPlayerId.empty()) {
    return false;
  }
  const SpotifyCdpPlayerEvidence* player =
      SpotifyFindPlayerEvidence(state, state.playbackPlayerId, false);
  return player && player->audioDecoder && player->audioTracks;
}

void EnsureSpotifyMediaStartEvidence(
    ICoreWebView2* webview, size_t accountIndex) noexcept {
  if (!webview || accountIndex >= gSpotifyMediaStartEvidence.size()) return;
  auto& state = gSpotifyMediaStartEvidence[accountIndex];
  if (state.webview == webview && state.registered) return;

  ReleaseSpotifyMediaStartEvidence(accountIndex);
  state.webview = webview;
  ICoreWebView2* const expectedWebview = webview;

  const auto propertiesHandler =
      Callback<ICoreWebView2DevToolsProtocolEventReceivedEventHandler>(
          [accountIndex, expectedWebview](
              ICoreWebView2*,
              ICoreWebView2DevToolsProtocolEventReceivedEventArgs* args)
              -> HRESULT {
            if (accountIndex >= gSpotifyMediaStartEvidence.size()) return S_OK;
            auto& current = gSpotifyMediaStartEvidence[accountIndex];
            if (current.webview != expectedWebview) return S_OK;
            try {
              using namespace winrt::Windows::Data::Json;
              const std::wstring parameters = SpotifyCdpEventParameters(args);
              if (parameters.empty()) return S_OK;
              const JsonObject root = JsonObject::Parse(parameters);
              const std::wstring playerId = SpotifyCdpString(root, L"playerId");
              if (playerId.empty() || !root.HasKey(L"properties")) return S_OK;
              const IJsonValue propertiesValue = root.GetNamedValue(L"properties");
              if (!propertiesValue ||
                  propertiesValue.ValueType() != JsonValueType::Array) {
                return S_OK;
              }
              const JsonArray properties = propertiesValue.GetArray();
              for (uint32_t index = 0; index < properties.Size(); ++index) {
                const IJsonValue item = properties.GetAt(index);
                if (!item || item.ValueType() != JsonValueType::Object) continue;
                const JsonObject property = item.GetObject();
                const std::wstring name = SpotifyCdpString(property, L"name");
                if (name != L"kAudioDecoderName" && name != L"kAudioTracks") {
                  continue;
                }
                SpotifyCdpPlayerEvidence* player =
                    SpotifyFindPlayerEvidence(current, playerId, true);
                if (!player) continue;
                const bool present = SpotifyCdpPropertyValuePresent(property);
                if (name == L"kAudioDecoderName") {
                  player->audioDecoder = present;
                } else {
                  player->audioTracks = present;
                }
              }
            } catch (...) {
              // Fail closed. Startup verification will retry on its bounded
              // two-second cadence if Chromium's Media payload is malformed.
            }
            return S_OK;
          });

  HRESULT result = webview->GetDevToolsProtocolEventReceiver(
      L"Media.playerPropertiesChanged", &state.propertiesReceiver);
  if (FAILED(result) || !state.propertiesReceiver ||
      FAILED(state.propertiesReceiver->add_DevToolsProtocolEventReceived(
          propertiesHandler.Get(), &state.propertiesToken))) {
    ReleaseSpotifyMediaStartEvidence(accountIndex);
    return;
  }

  const auto eventsHandler =
      Callback<ICoreWebView2DevToolsProtocolEventReceivedEventHandler>(
          [accountIndex, expectedWebview](
              ICoreWebView2*,
              ICoreWebView2DevToolsProtocolEventReceivedEventArgs* args)
              -> HRESULT {
            if (accountIndex >= gSpotifyMediaStartEvidence.size()) return S_OK;
            auto& current = gSpotifyMediaStartEvidence[accountIndex];
            if (current.webview != expectedWebview) return S_OK;
            try {
              using namespace winrt::Windows::Data::Json;
              const std::wstring parameters = SpotifyCdpEventParameters(args);
              if (parameters.empty()) return S_OK;
              const JsonObject root = JsonObject::Parse(parameters);
              const std::wstring playerId = SpotifyCdpString(root, L"playerId");
              if (playerId.empty() || !root.HasKey(L"events")) return S_OK;
              const IJsonValue eventsValue = root.GetNamedValue(L"events");
              if (!eventsValue || eventsValue.ValueType() != JsonValueType::Array) {
                return S_OK;
              }
              const JsonArray events = eventsValue.GetArray();
              for (uint32_t index = 0; index < events.Size(); ++index) {
                const IJsonValue item = events.GetAt(index);
                if (!item || item.ValueType() != JsonValueType::Object) continue;
                const JsonObject event = item.GetObject();
                const std::wstring name = SpotifyCdpString(event, L"name");
                const std::wstring value = SpotifyCdpString(event, L"value");
                ++current.eventSequence;
                if (current.eventSequence == 0) ++current.eventSequence;

                const bool destroyed =
                    SpotifyCdpContainsInsensitive(name, L"kWebMediaPlayerDestroyed") ||
                    SpotifyCdpContainsInsensitive(value, L"kWebMediaPlayerDestroyed");
                if (destroyed) {
                  SpotifyForgetPlayerEvidence(current, playerId);
                  continue;
                }

                const bool playEvent =
                    name == L"kPlay" || value == L"kPlay";
                const bool pipelinePlaying =
                    (name == L"kPipelineStateChange" ||
                     SpotifyCdpContainsInsensitive(
                         value, L"kPipelineStateChange")) &&
                    SpotifyCdpContainsInsensitive(value, L"kPlaying");
                if (!playEvent && !pipelinePlaying) continue;
                current.playbackPlayerId = playerId;
                current.playbackEventSequence = current.eventSequence;
              }
            } catch (...) {
              // Keep evidence absent on protocol parse failures.
            }
            return S_OK;
          });

  result = webview->GetDevToolsProtocolEventReceiver(
      L"Media.playerEventsAdded", &state.eventsReceiver);
  if (FAILED(result) || !state.eventsReceiver ||
      FAILED(state.eventsReceiver->add_DevToolsProtocolEventReceived(
          eventsHandler.Get(), &state.eventsToken))) {
    ReleaseSpotifyMediaStartEvidence(accountIndex);
    return;
  }

  result = webview->CallDevToolsProtocolMethod(L"Media.enable", L"{}", nullptr);
  if (FAILED(result)) {
    ReleaseSpotifyMediaStartEvidence(accountIndex);
    return;
  }
  state.registered = true;
}

}  // namespace
}  // namespace hp
