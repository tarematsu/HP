#!/usr/bin/env bash
set -uo pipefail

if (( $# < 3 )); then
  echo "usage: run-quiet.sh <label> <log-file> <command> [args...]" >&2
  exit 2
fi

label="$1"
log_file="$2"
shift 2

mkdir -p "$(dirname "$log_file")"

set +e
"$@" >"$log_file" 2>&1
status=$?
set -e

if (( status == 0 )); then
  printf '✓ %s\n' "$label"
  exit 0
fi

printf '::error::%s failed (exit %d)\n' "$label" "$status"
printf '%s\n' '--- CI failure excerpt ---'

python3 - "$log_file" <<'PY'
from pathlib import Path
import re
import sys

path = Path(sys.argv[1])
text = path.read_text(encoding="utf-8", errors="replace") if path.exists() else ""
lines = [re.sub(r"\x1b\[[0-9;]*m", "", line.rstrip()) for line in text.splitlines()]

failure = re.compile(
    r"(?i)(?:\bnot ok\b|assertionerror|err_(?:assertion|test|module|require)|"
    r"\bnpm error\b|\berror\b|\bfailed\b|\bfailure\b|\bfail(?:ed|ure)?\b|[×✖])"
)

hits = [index for index, line in enumerate(lines) if failure.search(line)]
selected: set[int] = set()
for index in hits[-6:]:
    for cursor in range(max(0, index - 2), min(len(lines), index + 6)):
        selected.add(cursor)

if selected:
    ordered = sorted(selected)
else:
    nonempty = [index for index, line in enumerate(lines) if line.strip()]
    ordered = nonempty[-30:]

if len(ordered) > 48:
    ordered = ordered[-48:]

previous = None
for index in ordered:
    if previous is not None and index > previous + 1:
        print("…")
    print(lines[index])
    previous = index

omitted = max(0, len(lines) - len(ordered))
if omitted:
    print(f"… {omitted} other log lines omitted; full log is in the failed-CI artifact …")
PY

printf '%s\n' '--- end CI failure excerpt ---'
exit "$status"
