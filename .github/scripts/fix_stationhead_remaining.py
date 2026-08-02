from __future__ import annotations

import re
import subprocess
from pathlib import Path

ROOT = Path.cwd()
HEADER = ROOT / "hp/native/src/sh_stats_session_policy_fix.h"
WEBVIEW = ROOT / "hp/native/src/sh_webview.cpp"
REBUILD_TEST = ROOT / "hp/video/test/stationhead-play-stats-rebuild-regression.test.js"
NATIVE_TEST = ROOT / "hp/video/test/stationhead-play-stats-native-state-regression.test.js"
MAX_LITERAL_CHARS = 6000


def replace_once(path: Path, old: str, new: str) -> None:
    source = path.read_text(encoding="utf-8")
    count = source.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one match, found {count}")
    path.write_text(source.replace(old, new, 1), encoding="utf-8", newline="\n")


def chunks(body: str) -> list[str]:
    parts: list[str] = []
    remaining = body
    while len(remaining) > MAX_LITERAL_CHARS:
        split_at = remaining.rfind("\n", 0, MAX_LITERAL_CHARS)
        if split_at < MAX_LITERAL_CHARS // 2:
            split_at = MAX_LITERAL_CHARS
        else:
            split_at += 1
        parts.append(remaining[:split_at])
        remaining = remaining[split_at:]
    parts.append(remaining)
    return parts


header = HEADER.read_text(encoding="utf-8")
replace_target = """    }, { once: true });
  }

  const resetSuccessThrottle = () => {"""
replace_value = """    });
  }

  const resetSuccessThrottle = () => {"""
if header.count(replace_target) != 1:
    raise RuntimeError("stats pagehide listener marker changed")
header = header.replace(replace_target, replace_value, 1)

capture_pattern = re.compile(
    r'  script\.append\(LR"JS\(([\s\S]*?)\)JS"\);\n  return script;',
)
capture_match = capture_pattern.search(header)
if not capture_match:
    raise RuntimeError("capture raw literal was not found")
capture_parts = chunks(capture_match.group(1))
capture_replacement = "\n".join(
    f'  script.append(LR"JS({part})JS");' for part in capture_parts
) + "\n  return script;"
header = capture_pattern.sub(lambda _: capture_replacement, header, count=1)

stats_pattern = re.compile(
    r'  script << LR"JS\(([\s\S]*?)\)JS" << channelId << LR"JS\(([\s\S]*?)\)JS";\n  return script\.str\(\);',
)
stats_match = stats_pattern.search(header)
if not stats_match:
    raise RuntimeError("stats raw literal boundary was not found")
first_parts = chunks(stats_match.group(1))
second_parts = chunks(stats_match.group(2))
stream_lines = [f'  script << LR"JS({part})JS";' for part in first_parts]
stream_lines.append("  script << channelId;")
stream_lines.extend(f'  script << LR"JS({part})JS";' for part in second_parts)
stream_lines.append("  return script.str();")
header = stats_pattern.sub(lambda _: "\n".join(stream_lines), header, count=1)
HEADER.write_text(header, encoding="utf-8", newline="\n")

webview_old = """                  const int64_t dayStart =
                      timestamp - timestamp % kDayMilliseconds;
                  points.push_back({
                      dayStart,
                      static_cast<int>(std::round(rawValue)),
                  });
                }
                std::sort(
                    points.begin(), points.end(),
                    [](const StationheadDailyPlayPoint& left,
                       const StationheadDailyPlayPoint& right) {
                      return left.dayStartMsUtc < right.dayStartMsUtc;
                    });
                std::vector<StationheadDailyPlayPoint> normalized;
                normalized.reserve(points.size());
                for (const auto& point : points) {
                  if (!normalized.empty() &&
                      normalized.back().dayStartMsUtc == point.dayStartMsUtc) {
                    normalized.back() = point;
                  } else {
                    normalized.push_back(point);
                  }
                }
"""
webview_new = """                  points.push_back({
                      timestamp,
                      static_cast<int>(std::round(rawValue)),
                  });
                }
                std::stable_sort(
                    points.begin(), points.end(),
                    [](const StationheadDailyPlayPoint& left,
                       const StationheadDailyPlayPoint& right) {
                      return left.dayStartMsUtc < right.dayStartMsUtc;
                    });
                std::vector<StationheadDailyPlayPoint> normalized;
                normalized.reserve(points.size());
                for (const auto& point : points) {
                  const int64_t dayStart =
                      point.dayStartMsUtc -
                      point.dayStartMsUtc % kDayMilliseconds;
                  if (!normalized.empty() &&
                      normalized.back().dayStartMsUtc == dayStart) {
                    normalized.back().value = point.value;
                  } else {
                    normalized.push_back({dayStart, point.value});
                  }
                }
"""
replace_once(WEBVIEW, webview_old, webview_new)

helper_old = """  const match = source.match(
    /script << LR\"JS\\(([\\s\\S]*?)\\)JS\"\\s*<< channelId << LR\"JS\\(([\\s\\S]*?)\\)JS\";/,
  );
  assert.ok(match, 'stats generator raw-string boundary is intact');
  return `${match[1]}${channelId}${match[2]}`;
"""
helper_new = """  const tokens = [...source.matchAll(
    /LR\"JS\\(([\\s\\S]*?)\\)JS\"|script << channelId;/g,
  )];
  assert.ok(tokens.length >= 3, 'stats generator raw-string boundary is intact');
  assert.equal(tokens.filter(token => token[0] === 'script << channelId;').length, 1);
  return tokens.map(token => token[1] ?? String(channelId)).join('');
"""
replace_once(REBUILD_TEST, helper_old, helper_new)

policy_test_old = """  assert.match(policy, /window\\.addEventListener\\('pagehide'/);
  assert.doesNotMatch(policy, /localStorage/);
});"""
policy_test_new = """  assert.match(policy, /window\\.addEventListener\\('pagehide'/);
  assert.doesNotMatch(
    policy,
    /window\\.addEventListener\\('pagehide',[\\s\\S]*?once: true/,
  );
  const rawLiteralSizes = [...policy.matchAll(/LR\"JS\\(([\\s\\S]*?)\\)JS\"/g)]
    .map(match => match[1].length);
  assert.ok(rawLiteralSizes.length >= 5);
  assert.ok(rawLiteralSizes.every(size => size < 8000));
  assert.doesNotMatch(policy, /localStorage/);
});"""
replace_once(REBUILD_TEST, policy_test_old, policy_test_new)

native_test_old = """  assert.match(webview, /std::sort\\(/);
  assert.match(webview, /normalized\\.back\\(\\)\\.dayStartMsUtc/);
  assert.match(webview, /timestamp % kDayMilliseconds/);
  assert.match(webview, /normalized\\.size\\(\\) > 45/);"""
native_test_new = """  assert.match(webview, /std::stable_sort\\(/);
  assert.match(webview, /points\\.push_back\\(\\{[\\s\\S]*timestamp/);
  assert.match(webview, /normalized\\.back\\(\\)\\.dayStartMsUtc/);
  assert.match(webview, /point\\.dayStartMsUtc % kDayMilliseconds/);
  assert.match(webview, /normalized\\.back\\(\\)\\.value = point\\.value/);
  assert.match(webview, /normalized\\.size\\(\\) > 45/);"""
replace_once(NATIVE_TEST, native_test_old, native_test_new)

workflow = subprocess.check_output(
    ["git", "show", "origin/main:.github/workflows/video-ci.yml"]
)
(ROOT / ".github/workflows/video-ci.yml").write_bytes(workflow)
Path(__file__).unlink(missing_ok=True)
