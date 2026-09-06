import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const runtimeConfig = JSON.parse(await readFile(
  new URL('../worker/wrangler.runtime.jsonc', import.meta.url),
  'utf8',
));
const sakurazakaConfig = JSON.parse(await readFile(
  new URL('../worker/wrangler.sakurazaka46jp.jsonc', import.meta.url),
  'utf8',
));
const officialProbeSource = await readFile(
  new URL('../worker/src/official-news-probe.js', import.meta.url),
  'utf8',
);

test('normal Buddies comments remain disabled while Sakurazaka raw chat keeps 50 items', () => {
  assert.equal(runtimeConfig.vars.CHAT_LIMIT, 0);
  assert.equal('SOLO_CHAT_LIMIT' in sakurazakaConfig.vars, false);
  assert.match(officialProbeSource, /chatHistory\?limit=50/);
});
