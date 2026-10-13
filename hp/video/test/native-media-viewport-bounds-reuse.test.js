import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const host = readFileSync(
  new URL('../../native/src/renderer_panels/media_host.inc', import.meta.url),
  'utf8',
);

const fragment = (begin, end) => {
  const from = host.indexOf(begin);
  const to = host.indexOf(end, from + begin.length);
  assert.ok(from >= 0 && to > from, `Missing native media fragment: ${begin}`);
  return host.slice(from, to);
};

test('media host does not issue WebView2 layout calls for identical effective bounds', () => {
  const resize = fragment('  void Resize() noexcept {', '  bool OnTimer(');
  assert.match(resize, /GetClientRect\(hostWindow_, &client\)/);
  assert.match(resize, /if \(width <= 1 \|\| height <= 1\)/);
  assert.match(resize, /GetClientRect\(parent, &parentClient\)/);
  assert.match(resize, /hasAppliedControllerBounds_ &&\s*EqualRect\(&lastAppliedControllerBounds_, &client\)\) return/);
  assert.match(resize, /if \(SUCCEEDED\(controller_->put_Bounds\(client\)\)\) \{\s*lastAppliedControllerBounds_ = client;\s*hasAppliedControllerBounds_ = true;/);
  assert.match(resize, /hasAppliedControllerBounds_ = true;\s*} else \{[\s\S]*hasAppliedControllerBounds_ = false;/);
  assert.equal((resize.match(/controller_->put_Bounds\(/g) || []).length, 1);
  assert.ok(resize.indexOf('EqualRect(&lastAppliedControllerBounds_, &client)') <
            resize.indexOf('controller_->put_Bounds(client)'));

  const cache = { valid: false, bounds: null, calls: [] };
  const update = (bounds, success = true) => {
    if (cache.valid &&
        Object.keys(bounds).every(key => cache.bounds[key] === bounds[key])) return;
    cache.calls.push({ ...bounds });
    if (success) { cache.bounds = { ...bounds }; cache.valid = true; }
  };
  const original = { left: 0, top: 0, right: 720, bottom: 405 };
  update(original);
  for (let i = 0; i < 100; i++) update(original);
  assert.equal(cache.calls.length, 1, 'unchanged frames should not reflow WebView2');
  update({ ...original, right: 640 });
  assert.equal(cache.calls.length, 2);
  cache.valid = false;
  update({ ...original, right: 640 });
  assert.equal(cache.calls.length, 3, 'new controller needs initial bounds');
  cache.valid = false;
  update(original, false);
  update(original);
  assert.equal(cache.calls.length, 5, 'failed bounds update must retry');
});

test('media host invalidates its bounds cache on controller replacement', () => {
  assert.match(host, /RECT lastAppliedControllerBounds_\{\};/);
  assert.match(host, /bool hasAppliedControllerBounds_ = false;/);
  const close = fragment('  void CloseController() noexcept {', '  void CreateControllerForCurrentPhase() noexcept {');
  assert.match(close, /controller_\.Reset\(\);\s*hasAppliedControllerBounds_ = false;/);
  const create = fragment('  void CreateControllerForCurrentPhase() noexcept {', '  void Configure() noexcept {');
  assert.match(create, /controller_ = controller;\s*hasAppliedControllerBounds_ = false;\s*controller_->get_CoreWebView2\(&webview_\)/);
  const configure = fragment('  void Configure() noexcept {', '  void ');
  assert.match(configure, /Resize\(\);/);
});
