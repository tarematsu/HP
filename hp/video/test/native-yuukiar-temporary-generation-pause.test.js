import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = name => readFileSync(
  new URL(`../../native/src/${name}`, import.meta.url), 'utf8');

const handles = source('app_stationhead_handles.cpp');
const stationhead = source('sh.h');

test('yuukiar Stationhead generation is paused only from 11:30 to 13:00 JST on 2026-09-21', () => {
  assert.match(stationhead, /UsesWebViewProfile\(std::wstring_view profileName\)/);
  assert.match(handles, /kYuukiarStationheadProfile\s*=\s*L"spotify-v2-2"/);
  assert.match(handles, /kYuukiarGenerationPauseStartUnixMs\s*=\s*1'789'957'800'000LL/);
  assert.match(handles, /kYuukiarGenerationPauseEndUnixMs\s*=\s*1'789'963'200'000LL/);
  assert.match(handles, /nowMs\s*>=\s*kYuukiarGenerationPauseStartUnixMs\s*&&[\s\S]*nowMs\s*<\s*kYuukiarGenerationPauseEndUnixMs/);
});

test('temporary pause stops an existing yuukiar window and restarts it after the interval', () => {
  assert.match(handles, /if \(generationPaused\) \{[\s\S]*player_->Stop\(\);[\s\S]*startIssued_ = false;/);
  assert.match(handles, /if \(!startIssued_\) \{[\s\S]*if \(wasTemporarilyPaused\) \{[\s\S]*temporaryGenerationPauses\.erase\(this\);[\s\S]*Start\(\);/);
  assert.match(handles, /void StationheadHandleBase::Start\(\) \{[\s\S]*IsYuukiarGenerationPaused\(\*player_, nowMs\)[\s\S]*return;/);
});
