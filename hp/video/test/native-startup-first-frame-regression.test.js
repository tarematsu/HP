import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const app = readFileSync(
  new URL('../../native/src/app.cpp', import.meta.url),
  'utf8',
);

test('native app primes the dashboard before exposing the top-level HWND', () => {
  const createWindow = app.slice(
    app.indexOf('void App::CreateMainWindow'),
    app.indexOf('void App::StartServices'),
  );
  assert.match(createWindow, /windowClass\.hbrBackground = nullptr/);
  assert.doesNotMatch(createWindow, /BLACK_BRUSH/);

  const startServices = app.slice(
    app.indexOf('void App::StartServices'),
    app.indexOf('void App::StartDeferredServices'),
  );
  const renderAt = startServices.indexOf('renderer_->Render();');
  const redrawAt = startServices.indexOf('RedrawWindow(window_');
  const showAt = startServices.indexOf('ShowWindow(window_, startupShowCommand_);');
  assert.ok(renderAt >= 0);
  assert.ok(redrawAt > renderAt);
  assert.ok(showAt > redrawAt);
  assert.match(
    startServices,
    /RDW_INVALIDATE \| RDW_UPDATENOW \| RDW_ALLCHILDREN/,
  );
});
