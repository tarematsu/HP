import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const dashboardHtml = readFileSync(new URL('../site/public/index.html', import.meta.url), 'utf8');

test('integrated archive views remain valid UTF-8 HTML instead of byte-pair mojibake', () => {
  assert.match(dashboardHtml, /^<!doctype html>\s*<html lang="ja">/i);
  assert.match(dashboardHtml, /<meta charset="utf-8">/i);
  assert.match(dashboardHtml, /id="historyView"/);
  assert.match(dashboardHtml, /id="likesView"/);
  assert.match(dashboardHtml, /data-mode="daily">日次/);
  assert.doesNotMatch(dashboardHtml, /data-mode="tracks"|>再生曲|href="\/history/);
  assert.equal(existsSync(new URL('../site/public/history/index.html', import.meta.url)), false);
  assert.doesNotMatch(dashboardHtml, /[㰀-㿿]{3,}/u);
  assert.doesNotMatch(dashboardHtml, /\uFFFD/u);
});
