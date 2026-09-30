import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const dashboardHtml = readFileSync(new URL('../site/public/index.html', import.meta.url), 'utf8');
const historyShell = readFileSync(new URL('../site/public/history-shell.js', import.meta.url), 'utf8');
const likesShell = readFileSync(new URL('../site/public/likes-shell.js', import.meta.url), 'utf8');
const tabRegistry = readFileSync(new URL('../site/public/dashboard-tab-registry.js', import.meta.url), 'utf8');
const dashboardUi = [dashboardHtml, historyShell, likesShell, tabRegistry].join('\n');

test('integrated archive views remain valid UTF-8 HTML instead of byte-pair mojibake', () => {
  assert.match(dashboardHtml, /^<!doctype html>\s*<html\b[^>]*\blang="ja"[^>]*>/i);
  assert.match(dashboardHtml, /<meta charset="utf-8">/i);
  assert.match(historyShell, /id: 'historyView'/);
  assert.match(likesShell, /id: 'likesView'/);
  assert.match(tabRegistry, /view: 'history', mode: 'daily', label: '過去'/);
  assert.doesNotMatch(dashboardUi, /mode: 'tracks'|>再生曲|href="\/history/);
  assert.equal(existsSync(new URL('../site/public/history/index.html', import.meta.url)), false);
  assert.doesNotMatch(dashboardUi, /[㰀-㿿]{3,}/u);
  assert.doesNotMatch(dashboardUi, /\uFFFD/u);
});