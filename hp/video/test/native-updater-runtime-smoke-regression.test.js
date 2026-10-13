import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflow = readFileSync(
  new URL('../../../.github/workflows/native-runtime-smoke.yml', import.meta.url),
  'utf8',
);
const script = readFileSync(
  new URL('../../native/scripts/ci-updater-runtime-smoke.ps1', import.meta.url),
  'utf8',
);

test('Windows runtime smoke builds and executes HomePanelUpdater', () => {
  assert.match(workflow, /--target HomePanel HomePanelUpdater --parallel/);
  assert.match(
    workflow,
    /ci-updater-runtime-smoke\.ps1[\s\S]*-UpdaterExecutable[\s\S]*HomePanelUpdater\.exe/,
  );
  assert.match(
    workflow,
    /-Version "\$\{\{ steps\.version\.outputs\.version \}\}"/,
  );
  assert.match(workflow, /hp\/native\/ci-updater-runtime-smoke/);
});

test('updater smoke uses the real runner protocol without network or playback logs', () => {
  assert.match(script, /"--pid", \[string\]\$PID/);
  assert.match(script, /"--app-pid", \[string\]\$PID/);
  assert.match(script, /"--root", \$installRoot/);
  assert.match(script, /"--manifest", \$manifestPath/);
  assert.match(script, /"--version", \$Version/);
  assert.match(script, /updaterExitCode = \$updaterProcess\.ExitCode/);
  assert.match(script, /runtimeFileLoggingDisabled = \$true/);
  assert.match(script, /unexpectedly created data\/homepanel-updater\.log/);
});

test('updater smoke verifies manifest cleanup, binary integrity and restart directly', () => {
  assert.match(script, /HomePanelUpdater did not remove the verified pending manifest/);
  assert.match(script, /Same-version verification unexpectedly modified/);
  assert.match(script, /HomePanelUpdater did not restart HomePanel\.exe/);
  assert.match(script, /HomePanelNativeWindow/);
  assert.match(script, /Restarted HomePanel returned exit code/);
  assert.match(script, /unexpectedly created data\/homepanel\.log/);
  assert.match(script, /Windows Application log contains HomePanel or updater error events/);
});


test('pull-request native CI uses one Windows build and preserves manual full smoke', () => {
  const nativeBuild = readFileSync(
    new URL('../../../.github/workflows/native-windows-build.yml', import.meta.url), 'utf8',
  );
  assert.doesNotMatch(workflow, /^  pull_request:/m,
    'duplicate native runtime smoke should not run for every PR push');
  assert.match(workflow, /^  push:\n\s+branches:\n\s+- main/m);
  assert.match(workflow, /^  workflow_dispatch:/m);
  assert.match(nativeBuild, /^  pull_request:/m,
    'PRs must still compile the native application');
  assert.match(nativeBuild, /-DHOMEPANEL_CI_STRICT=ON/);
  assert.match(nativeBuild,
    /- name: Configure MSVC static analysis\n\s+if: github.event_name == 'workflow_dispatch'/);
  assert.match(nativeBuild,
    /- name: Run MSVC static analysis\n\s+if: github.event_name == 'workflow_dispatch'/);
  assert.match(nativeBuild,
    /- name: Package native release\n\s+if: github.ref == 'refs\/heads\/main' \|\| github.event_name == 'workflow_dispatch'/);
});
