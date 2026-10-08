import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = name => readFileSync(
  new URL(`../../native/src/${name}`, import.meta.url), 'utf8');




const radar = source('renderer_radar_ui.cpp');
const mediaBase = source('renderer_panels/media_section_base.inc');
const mediaWindow = source('renderer_panels/media_host_window.inc');

test('rain radar decoding yields CPU priority to playback work', () => {
  assert.match(
    radar,
    /radarComposeThread_ = std::thread\(\[this\] \{[\s\S]*SetThreadPriority\(GetCurrentThread\(\), THREAD_PRIORITY_BELOW_NORMAL\)/,
  );
  assert.match(radar, /ComposeRadarFrame\(\)/);
});

