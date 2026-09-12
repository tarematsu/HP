namespace hp {
namespace {

// Assemble independently valid observer responsibilities into one ExecuteScript
// call. Playback recovery/heartbeat is intentionally absent; the observer only
// tracks target identity and natural completion.
const std::wstring kSpotifyFastEndObserverScriptStorage = [] {
  std::wstring script;
  script.reserve(
      std::size(kSpotifyMediaObserverRuntimeScript) +
      std::size(kSpotifyMediaObserverCompletionScript) +
      std::size(kSpotifyMediaObserverEventsScript) + 4U);
  script.append(kSpotifyMediaObserverRuntimeScript);
  script.append(L";\n");
  script.append(kSpotifyMediaObserverCompletionScript);
  script.append(L";\n");
  script.append(kSpotifyMediaObserverEventsScript);
  script.push_back(L';');
  return script;
}();

const wchar_t* const kSpotifyFastEndObserverScript =
    kSpotifyFastEndObserverScriptStorage.c_str();

}  // namespace
}  // namespace hp
