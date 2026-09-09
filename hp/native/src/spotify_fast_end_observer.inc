namespace hp {
namespace {

// Assemble independently valid observer responsibilities into one ExecuteScript
// call. The scripts communicate only through the explicit window runtime object;
// they do not depend on concatenated lexical scope or arbitrary literal splits.
const std::wstring kSpotifyFastEndObserverScriptStorage = [] {
  std::wstring script;
  script.reserve(
      std::size(kSpotifyMediaObserverRuntimeScript) +
      std::size(kSpotifyMediaObserverEventsScript) +
      std::size(kSpotifyMediaObserverHeartbeatScript));
  script.append(kSpotifyMediaObserverRuntimeScript);
  script.push_back(L'\n');
  script.append(kSpotifyMediaObserverEventsScript);
  script.push_back(L'\n');
  script.append(kSpotifyMediaObserverHeartbeatScript);
  return script;
}();

const wchar_t* const kSpotifyFastEndObserverScript =
    kSpotifyFastEndObserverScriptStorage.c_str();

}  // namespace
}  // namespace hp
