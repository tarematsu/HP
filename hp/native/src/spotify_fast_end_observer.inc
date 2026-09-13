namespace hp {
namespace {

// Assemble target recognition and the minimal media lifecycle bindings into one
// ExecuteScript call. Native still owns the one-shot completion deadline; an
// ended event is only an advisory signal that may shorten that same deadline.
const std::wstring kSpotifyFastEndObserverScriptStorage = [] {
  std::wstring script;
  script.reserve(
      std::size(kSpotifyMediaObserverRuntimeScript) +
      std::size(kSpotifyMediaObserverEventsScript) + 3U);
  script.append(kSpotifyMediaObserverRuntimeScript);
  script.append(L";\n");
  script.append(kSpotifyMediaObserverEventsScript);
  script.push_back(L';');
  return script;
}();

const wchar_t* const kSpotifyFastEndObserverScript =
    kSpotifyFastEndObserverScriptStorage.c_str();

}  // namespace
}  // namespace hp
