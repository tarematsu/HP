import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const updateSource = readFileSync(
  new URL('../../native/src/app_update.cpp', import.meta.url),
  'utf8',
);

function section(source, start, end) {
  const startAt = source.indexOf(start);
  assert.notEqual(startAt, -1, `missing section: ${start}`);
  const endAt = source.indexOf(end, startAt + start.length);
  assert.notEqual(endAt, -1, `missing section terminator: ${end}`);
  return source.slice(startAt, endAt);
}

test('same-version native releases are detected by executable hash', () => {
  const hashHelper = section(
    updateSource,
    'std::wstring InstalledHomePanelSha256(',
    'bool ManifestExecutableDiffers(',
  );
  assert.match(hashHelper, /kMaximumComparableExecutableBytes/);
  assert.match(hashHelper, /fs::file_size\(/);
  assert.match(hashHelper, /Sha256Hex\(bytes\)/);

  const manifestDiff = section(
    updateSource,
    'bool ManifestExecutableDiffers(',
    '\n\n}  // namespace',
  );
  assert.match(manifestDiff, /candidate\.name == L"HomePanel\.exe"/);
  assert.match(manifestDiff, /installedHash != file->sha256/);

  const updateCheck = section(
    updateSource,
    'void App::CheckForUpdateAsync(bool install)',
    'bool App::LaunchVerifiedUpdater(',
  );
  assert.match(
    updateCheck,
    /const bool newerVersion = IsVersionNewer\(manifest\.version, currentVersion\)/,
  );
  assert.match(
    updateCheck,
    /!newerVersion && !IsVersionNewer\(currentVersion, manifest\.version\)[\s\S]*ManifestExecutableDiffers\(manifest, executable\)/,
  );
  assert.match(updateCheck, /if \(!newerVersion && !replacementBuild\)/);
  assert.match(updateCheck, /if \(replacementBuild\)[\s\S]*same version and a different executable hash/);
});
