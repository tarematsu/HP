import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const critical = await readFile(new URL('../public/critical.css', import.meta.url), 'utf8');
const pending = await readFile(new URL('../public/auth-pending.js', import.meta.url), 'utf8');
const bootstrap = await readFile(new URL('../public/auth-bootstrap.js', import.meta.url), 'utf8');

test('authentication screen remains visually hidden while a stored token is restored', () => {
  assert.match(html, /class="is-locked is-auth-pending"/);
  assert.doesNotMatch(html, /id="authGate"[^>]*\shidden(?:\s|>)/);
  assert.match(critical, /body\.is-auth-pending #authGate/);
  assert.match(pending, /videoscraper:admin-token-change/);
});

test('authentication form remains available if bootstrap loading fails', () => {
  assert.match(html, /<section id="authGate" aria-label="認証">/);
  assert.match(pending, /if \(!stored\) \{\s*finish\(\)/);
});

test('authentication pending fallback runs before module startup', () => {
  const pendingIndex = html.indexOf('/auth-pending.js');
  const authIndex = html.indexOf('/auth-bootstrap.js');
  const playerIndex = html.indexOf('/app-resilient.js');
  assert.ok(pendingIndex >= 0);
  assert.ok(authIndex > pendingIndex);
  assert.ok(playerIndex > authIndex);
  assert.match(bootstrap, /initializeAuthGate\(\)/);
  assert.match(bootstrap, /initializeAdminTokenButton\(\)/);
});

test('authentication pending state has a bounded fallback', () => {
  assert.match(pending, /setTimeout\(finish, 5000\)/);
});

test('critical authentication and landscape feedback styles use an external stylesheet', () => {
  assert.match(html, /href="\/critical\.css"/);
  assert.match(critical, /#tapFeedback\[data-side="top"\]/);
  assert.match(critical, /#tapFeedback\[data-side="bottom"\]/);
});
