import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const styles = readFileSync(new URL('../public/spotify.css', import.meta.url), 'utf8');

test('Spotify trend graph fits the mobile viewport without horizontal scrolling', () => {
  assert.match(styles, /@media \(max-width: 640px\)[\s\S]*\.spotify-trend-scroll\s*\{[\s\S]*width:\s*100%;[\s\S]*min-width:\s*0;[\s\S]*overflow-x:\s*hidden;/);
  assert.match(styles, /@media \(max-width: 640px\)[\s\S]*\.spotify-trend-svg\s*\{[\s\S]*width:\s*100%;[\s\S]*min-width:\s*0;[\s\S]*max-width:\s*100%;/);
});
