import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const policy = readFileSync(
  new URL('../../native/src/sh_data_acquisition_resource_policy_fix.h', import.meta.url),
  'utf8',
);

test('SelectedGIF mixed account module is not replaced', () => {
  assert.match(
    policy,
    /StationheadHashedAssetModulePathMatches\(uri\.path, L"selectedgif"\)[\s\S]*return \{\};/,
  );
  assert.match(
    policy,
    /StationheadKnownOptionalModuleStubBoundaryFixed\(uriLower\)/,
  );
});
