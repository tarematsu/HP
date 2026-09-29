import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const updaterEntry = readFileSync(
  new URL('../../native/src/updater_entry.cpp', import.meta.url),
  'utf8',
);

function section(start, end) {
  const startIndex = updaterEntry.indexOf(start);
  assert.notEqual(startIndex, -1, `missing section start: ${start}`);
  const endIndex = updaterEntry.indexOf(end, startIndex + start.length);
  assert.notEqual(endIndex, -1, `missing section end: ${end}`);
  return updaterEntry.slice(startIndex, endIndex);
}

test('standalone updater fetches manifest with the verified downloader instead of CloudClient', () => {
  const fetch = section(
    'std::string FetchAuthorizedManifest(',
    'void VerifyInstalledFiles(',
  );
  assert.match(fetch, /LoadConfig/);
  assert.match(fetch, /LoadProtectedToken/);
  assert.match(fetch, /cloudflareBaseUrl/);
  assert.match(fetch, /\/v1\/update\/manifest/);
  assert.match(fetch, /DownloadHttpsFile/);
  assert.doesNotMatch(fetch, /CloudClient/);
});

test('standalone updater leaves stage markers around manifest retrieval and parsing', () => {
  const standalone = section(
    'int HardenedRunStandalone(',
    'void HardenedInstallPendingUpdate(',
  );
  assert.match(standalone, /Authenticated manifest fetch started/);
  assert.match(standalone, /Authenticated manifest bytes received/);
  assert.match(standalone, /Authenticated manifest parsed version/);
  assert.match(standalone, /Authenticated confirmed manifest fetch started/);
  assert.match(standalone, /Authenticated confirmed manifest parsed version/);
});

test('updater process initializes a WinRT apartment before either standalone or runner JSON parsing', () => {
  assert.match(updaterEntry, /class ScopedWinRtApartment/);
  assert.match(updaterEntry, /winrt::init_apartment\(winrt::apartment_type::single_threaded\)/);
  const main = section('int WINAPI wWinMain(', 'catch (const std::exception& error)');
  assert.match(main, /ScopedWinRtApartment apartment/);
});
