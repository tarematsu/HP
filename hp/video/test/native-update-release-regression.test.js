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

test('same-version native releases compare every installed release file', () => {
  const comparison = section(
    updateSource,
    'InstalledFileComparison CompareInstalledFile(',
    'bool ManifestFilesDiffer(',
  );
  assert.match(comparison, /fs::exists\(path, error\)/);
  assert.match(comparison, /!exists\)[\s\S]*InstalledFileComparison::Differs/);
  assert.match(comparison, /size != file\.size/);
  assert.match(comparison, /kMaximumComparableUpdateFileBytes/);
  assert.match(comparison, /Sha256Hex\(bytes\) == file\.sha256/);
  assert.match(comparison, /catch \(\.\.\.\)[\s\S]*InstalledFileComparison::Unavailable/);

  const manifestDiff = section(
    updateSource,
    'bool ManifestFilesDiffer(',
    '\n\n}  // namespace',
  );
  assert.match(manifestDiff, /for \(const auto& file : manifest\.files\)/);
  assert.match(manifestDiff, /CompareInstalledFile\(root \/ file\.name, file\)/);
  assert.doesNotMatch(manifestDiff, /HomePanel\.exe/);

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
    /!newerVersion && !IsVersionNewer\(currentVersion, manifest\.version\)[\s\S]*ManifestFilesDiffer\(manifest, rootDir_\)/,
  );
  assert.match(updateCheck, /if \(!newerVersion && !replacementBuild\)/);
  assert.match(updateCheck, /if \(replacementBuild\)[\s\S]*same version and different release files/);
});
