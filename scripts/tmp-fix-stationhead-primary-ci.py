from pathlib import Path
import re


def replace_once(path: str, old: str, new: str, label: str) -> None:
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected one match, got {count}')
    p.write_text(text.replace(old, new), encoding='utf-8')


def regex_once(path: str, pattern: str, repl: str, label: str) -> None:
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    updated, count = re.subn(pattern, repl, text, count=1, flags=re.S)
    if count != 1:
        raise RuntimeError(f'{label}: expected one match, got {count}')
    p.write_text(updated, encoding='utf-8')


replace_once(
    'hp/video/test/native-stationhead-audio-routing-regression.test.js',
    "  const applyMute = section(audio, 'void StationheadPlayer::ApplyMute() const noexcept',\n    'void StationheadPlayer::EnsureDistinctBrowserIdentity() noexcept');",
    "  const applyMute = section(audio, 'void StationheadPlayer::ApplyMute() const noexcept',\n    '}  // namespace hp');",
    'native audio routing section terminator',
)

replace_once(
    'hp/video/test/stationhead-audio-control-crash-regression.test.js',
    "    'void StationheadPlayer::ApplyMute() const noexcept',\n    'void StationheadPlayer::EnsureDistinctBrowserIdentity() noexcept',",
    "    'void StationheadPlayer::ApplyMute() const noexcept',\n    '}  // namespace hp',",
    'audio crash section terminator',
)

p = Path('hp/video/test/stationhead-auto-click-clock-regression.test.js')
s = p.read_text(encoding='utf-8')
s = s.replace(
    "test('Start Listening retry deadlines are retained per Stationhead role', () => {",
    "test('Start Listening retry deadline is retained for the single Stationhead player', () => {",
)
s = s.replace(
    "  assert.match(\n    clockPolicy,\n    /inline MonotonicProjectedDeadline secondaryAutoClickDeadline;/,\n  );\n",
    "  assert.doesNotMatch(clockPolicy, /secondaryAutoClickDeadline|secondaryAutoClickExposed/);\n",
)
s = s.replace("  assert.match(clockPolicy, /secondaryAutoClickExposed = 0;/);\n", '')
s = s.replace(
    r"/#define nextAutoClickAt_[\s\S]*StationheadAutoClickDeadlineStorage[\s\S]*\(nextAutoClickAt_\), IsSecondary\(\)/,",
    r"/#define nextAutoClickAt_[\s\S]*StationheadAutoClickDeadlineStorage[\s\S]*\(nextAutoClickAt_\)\)\)/,",
)
p.write_text(s, encoding='utf-8')

replace_once(
    'hp/video/test/stationhead-native-stats-static-regression.test.js',
    "  assert.match(playerSource, /!IsSecondary\\(\\)[\\s\\S]*PollDailyPlayStats\\(nowMs\\)/);",
    "  assert.match(\n    playerSource,\n    /nowMs - lastDailyPlayStatsAt_ >= kStationheadDailyPlayStatsIntervalMs\\) PollDailyPlayStats\\(nowMs\\)/,\n  );\n  assert.doesNotMatch(playerSource, /IsSecondary\\(/);",
    'single player stats ownership',
)

replace_once(
    'hp/video/test/stationhead-operational-clock-regression.test.js',
    "  assert.match(playerHeader, /MonotonicElapsedTimestamp lastAuthProbeAt_;/);",
    "  assert.doesNotMatch(playerHeader, /lastAuthProbeAt_|authProbeInFlight_|authProbeStartedAt_/);",
    'removed secondary auth probe clock',
)

p = Path('hp/video/test/stationhead-startup-resource-reduction-regression.test.js')
s = p.read_text(encoding='utf-8')
old_loop = """  for (const role of ['A', 'B']) {\n    assert.match(\n      nativeStartupSmoke,\n      new RegExp(`Stationhead ${role} registering required startup scripts`),\n    );\n    assert.match(\n      nativeStartupSmoke,\n      new RegExp(`Stationhead ${role} auto-clicking Start Listening at`),\n    );\n  }\n"""
new_loop = """  assert.match(nativeStartupSmoke, /Stationhead A registering required startup scripts/);\n  assert.match(nativeStartupSmoke, /Stationhead A auto-clicking Start Listening at/);\n  assert.doesNotMatch(nativeStartupSmoke, /Stationhead B|SecondaryStationhead/);\n"""
if s.count(old_loop) != 1:
    raise RuntimeError('startup smoke A/B loop did not match exactly once')
s = s.replace(old_loop, new_loop)
s = s.replace(
    "  assert.match(nativeStartupSmoke, /Started non-mutating Stationhead surface observation at first host creation/);\n",
    "  assert.match(nativeStartupSmoke, /if \\(\\$primaryHostSeen -and -not \\$firstSurfaceObservationAtUtc\\)/);\n  assert.match(nativeStartupSmoke, /\\$firstSurfaceObservationAtUtc = \\[DateTime\\]::UtcNow/);\n",
)
s = s.replace(
    "  assert.match(nativeStartupSmoke, /sampleIntervalMs = 25/);\n",
    "  assert.match(nativeStartupSmoke, /Start-Sleep -Milliseconds 25/);\n",
)
s = s.replace(
    "  assert.match(nativeStartupSmoke, /secondaryHostSeen = \\$secondaryHostSeen/);\n",
    "  assert.doesNotMatch(nativeStartupSmoke, /secondaryHostSeen/);\n",
)
p.write_text(s, encoding='utf-8')

p = Path('hp/native/src/sh_track_boundary_message_policy.h')
s = p.read_text(encoding='utf-8')
pattern = r'(inline std::wstring StationheadAutoplayScriptCurrentInteraction\([\s\S]*?\n  return script;\n\})\n\n+(#define kStationheadPostPlaybackStopClickDelayMs)'
replacement = r"\1\n\ninline constexpr int64_t kStationheadMeasuredPostPlaybackStopClickDelayMs =\n    3'500;\nstatic_assert(kStationheadMeasuredPostPlaybackStopClickDelayMs < 12'000);\n\n}  // namespace hp\n\n\2"
s, count = re.subn(pattern, replacement, s, count=1)
if count != 1:
    raise RuntimeError(f'measured click delay restore: expected one match, got {count}')
p.write_text(s, encoding='utf-8')
