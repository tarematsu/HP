namespace hp {

void SpotifyWebViews::PostSpotifyTargetDescriptorForSlot(Slot& slot) noexcept {
  if (!slot.webview) return;

  std::wstring_view pagePath;
  std::wstring_view trackPath;
  std::wstring_view title;
  std::wstring_view kind = L"none";

  const MusicTargetDescriptor target = ResolveMusicTarget(slot);
  if (target.path) {
    pagePath = target.path;
    trackPath = target.path;
    title = target.title ? target.title : L"";
    kind = L"music";
  }

  std::wstring message = L"spotify:target";
  const auto appendField = [&message](std::wstring_view value) {
    message.push_back(kSpotifyMessageSeparator);
    message.append(value);
  };
  appendField(pagePath);
  appendField(trackPath);
  appendField(title);
  appendField(kind);
  slot.webview->PostWebMessageAsString(message.c_str());

  std::wstring generationMessage = L"spotify:generation";
  generationMessage.push_back(kSpotifyMessageSeparator);
  generationMessage.append(std::to_wstring(slot.targetGeneration));
  slot.webview->PostWebMessageAsString(generationMessage.c_str());
}

}  // namespace hp
