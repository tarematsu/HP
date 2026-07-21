import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const securityHeaders = await readFile(new URL('../src/security-headers.js', import.meta.url), 'utf8');

test('strict CSP is compatible with the deployed HTML', () => {
  assert.match(securityHeaders, /"script-src 'self'"/);
  assert.match(securityHeaders, /"style-src 'self'"/);
  assert.doesNotMatch(securityHeaders, /unsafe-inline/);
  assert.doesNotMatch(html, /<style(?:\s|>)/i);
  assert.doesNotMatch(html, /<script(?![^>]*\ssrc=)[^>]*>/i);
});

test('startup assets are external and same-origin', () => {
  assert.match(html, /<link rel="stylesheet" href="\/critical\.css">/);
  assert.match(html, /<script src="\/auth-pending\.js"><\/script>/);
});
