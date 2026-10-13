import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const host = readFileSync(
  new URL('../../native/src/renderer_panels/media_host.inc', import.meta.url),
  'utf8');

function between(begin, end) {
  const start = host.indexOf(begin);
  const finish = host.indexOf(end, start + begin.length);
  assert.ok(start >= 0 && finish > start, 'missing native media segment ' + begin);
  return host.slice(start, finish);
}

const bridge = readFileSync(
  new URL('../../native/src/renderer_panels/media_section.inc', import.meta.url), 'utf8');

test('media wake bridge rejects unrelated messages before allocating a source URL', () => {
  const start = bridge.indexOf('  const HRESULT registered = webview->add_WebMessageReceived(');
  const end = bridge.indexOf('  EventRegistrationToken navigationStartingToken{};', start);
  assert.ok(start >= 0 && end > start);
  const handler = bridge.slice(start, end);
  const filter = handler.indexOf('if (!mediaMessage) return S_OK;');
  const urlRead = handler.indexOf('sender->get_Source(&rawSource)');
  assert.ok(filter >= 0 && urlRead > filter, 'filter must precede COM URL lookup');
  const allowed = ['youtube-fullscreen-key', 'youtube-wake', 'tver-fullscreen-key',
    'tver-media-init', 'tver-ended', 'tver-wake'];
  for (const command of allowed) {
    assert.ok(handler.includes('homepanel:' + command.replace(/^youtube/, 'youtube').replace(/^tver/, 'tver')),
      'missing native media message ' + command);
  }
  assert.match(handler, /message\.starts_with\(L"homepanel:x-like:"\)/);
  assert.match(handler, /sourceContains\(L"x\.com\/home"\)/);
  assert.match(handler, /sourceContains\(L"youtube\.com\/watch"\)/);
  assert.match(handler, /sourceContains\(L"tver\.jp\/episodes\/"\)/);
});

test('YouTube playlist and watch URL classifiers fetch WebView source only once', () => {
  const methods = between('  bool IsYoutubePlaylistPage() noexcept {',
                          '  bool ScheduleNavigationRetry() noexcept {');
  assert.match(methods,
    /bool IsYoutubePlaylistPage\(\) noexcept \{\s*return SourceContains\(L"youtube\.com\/playlist", L"list=PLMWqSdpIVl30"\);/);
  assert.match(methods,
    /bool IsYoutubeWatchPage\(\) noexcept \{\s*return SourceContains\(L"youtube\.com\/watch", L"list=PLMWqSdpIVl30"\);/);
  assert.match(methods,
    /bool IsTverPage\(\) noexcept \{ return SourceContains\(L"tver\.jp\/"\); \}/);
  assert.match(methods,
    /bool SourceContains\(std::wstring_view needle,\s*std::wstring_view required = \{\}\) noexcept/);
  assert.equal((methods.match(/webview_->get_Source\(&source\)/g) || []).length, 1);
  assert.doesNotMatch(methods, /SourceContains\(L"youtube\.com\/(?:playlist|watch)"\) &&/);
});

test('URL search uses COM-owned buffer as a view and always frees it', () => {
  const body = between('  bool SourceContains(std::wstring_view needle,',
                       '  bool ScheduleNavigationRetry() noexcept {');
  assert.match(body, /const HRESULT result = webview_->get_Source\(&source\)/);
  assert.match(body, /if \(FAILED\(result\) \|\| !source\) \{\s*if \(source\) CoTaskMemFree\(source\);\s*return false;/);
  assert.match(body, /const std::wstring_view value\(source\)/);
  assert.match(body, /value\.find\(needle\) != std::wstring_view::npos/);
  assert.match(body, /required\.empty\(\) \|\| value\.find\(required\) != std::wstring_view::npos/);
  assert.match(body, /CoTaskMemFree\(source\);\s*return matches;/);
  assert.doesNotMatch(body, /const std::wstring value\(source\)/);
  assert.ok(body.indexOf('const std::wstring_view value(source)') <
            body.lastIndexOf('CoTaskMemFree(source)'));

  const check = (url, first, required = '') =>
    url.includes(first) && (!required || url.includes(required));
  const playlist = 'https://www.youtube.com/playlist?list=PLMWqSdpIVl30';
  const watch = 'https://www.youtube.com/watch?v=123&list=PLMWqSdpIVl30';
  assert.equal(check(playlist, 'youtube.com/playlist', 'list=PLMWqSdpIVl30'), true);
  assert.equal(check(watch, 'youtube.com/watch', 'list=PLMWqSdpIVl30'), true);
  assert.equal(check(watch, 'youtube.com/playlist', 'list=PLMWqSdpIVl30'), false);
  assert.equal(check('https://www.youtube.com/watch?v=123',
                     'youtube.com/watch', 'list=PLMWqSdpIVl30'), false);
  assert.equal(check('https://tver.jp/episodes/example', 'tver.jp/'), true);
});

test('YouTube and TVer watchdog decisions retain page classification and recovery', () => {
  const youtube = between('  HRESULT HandleYoutubeWatchdogResult(',
                          '  void ProbeTverWatchdog() noexcept {');
  const tver = between('  void ProbeTverWatchdog() noexcept {',
                       '  void Fail() noexcept {');
  assert.match(youtube, /phase_ != Phase::YouTube \|\| !webview_ \|\| !IsYoutubeWatchPage\(\)/);
  assert.match(youtube, /phase_ != Phase::YouTube \|\| !IsYoutubeWatchPage\(\)/);
  assert.match(tver, /phase_ != Phase::Tver \|\| !webview_\) return;/);
  assert.match(tver, /if \(source\.find\(L"tver\.jp\/"\) == std::wstring_view::npos\) \{\s*SetRecoveryState\(RecoveryState::Reloading\);\s*NavigateCurrentPhase\(\)/);
  assert.match(tver, /phase_ != Phase::Tver \|\| !IsTverPage\(\)/);
});

test('TVer watchdog reads one borrowed source URL for classification and startup recovery', () => {
  const tver = between('  void ProbeTverWatchdog() noexcept {',
                       '  void Fail() noexcept {');
  assert.equal((tver.match(/webview_->get_Source\(&rawSource\)/g) || []).length, 1);
  assert.match(tver, /const std::unique_ptr<wchar_t, decltype\(&CoTaskMemFree\)> sourceOwner\(/);
  assert.match(tver, /const std::wstring_view source = SUCCEEDED\(sourceResult\) && rawSource/);
  assert.match(tver, /NativeMediaTverStartupExpired\(source, now\)/);
  assert.doesNotMatch(tver, /std::wstring source;|source\.assign\(rawSource\)/);
  const isTver = url => url.includes('tver.jp/');
  assert.equal(isTver('https://tver.jp/episodes/abc'), true);
  assert.equal(isTver('https://www.youtube.com/watch?v=abc'), false);
  assert.equal(isTver(''), false);
});
