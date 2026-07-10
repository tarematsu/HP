from __future__ import annotations

import pathlib
import re
import subprocess

ROOT = pathlib.Path(__file__).resolve().parents[2]

RENAMES = {
    "cloud/migrations/202607102330_stationhead_health_job.sql": "cloud/migrations/202607102330_sh_health_job.sql",
    "cloud/src/stationhead_health.ts": "cloud/src/sh_health.ts",
    "cloud/test/stationhead_health.test.ts": "cloud/test/sh_health.test.ts",
    "native/src/stationhead_window_layout.cpp": "native/src/sh_window_layout.cpp",
}

# Deployed/public contracts intentionally retain their existing names.
PROTECTED = {
    "Stationhead",
    "stationhead",
    "stationhead_health",
    "stationhead_ok",
    "stationheadVersion",
    "reconnect_stationhead",
    "STATIONHEAD_MONITOR_URL",
    "STATIONHEAD_HEALTH_URL",
    "STATIONHEAD_HEALTH_STALE_MS",
    "STATIONHEAD_ALERT_TO",
    "STATIONHEAD_ALERT_FROM",
}

TEMPORARY = {
    ".github/workflows/sh-refactor-scan.yml",
    ".github/scripts/collect-sh-inventory.mjs",
    ".github/scripts/apply-sh-refactor.py",
}

IDENTIFIER = re.compile(r"\b[A-Za-z_][A-Za-z0-9_]*\b")


def git(*args: str) -> str:
    return subprocess.check_output(["git", *args], cwd=ROOT, text=True).strip()


def rename_identifier(token: str) -> str:
    if token in PROTECTED or "stationhead" not in token.lower():
        return token
    return token.replace("STATIONHEAD", "SH").replace("Stationhead", "Sh").replace("stationhead", "sh")


def text_file(path: pathlib.Path) -> str | None:
    data = path.read_bytes()
    if b"\0" in data[:8192]:
        return None
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError:
        return None


for old, new in RENAMES.items():
    old_path = ROOT / old
    if old_path.exists():
        (ROOT / new).parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(["git", "mv", old, new], cwd=ROOT, check=True)

tracked = [item for item in git("ls-files").splitlines() if item and item not in TEMPORARY]
for relative in tracked:
    path = ROOT / relative
    if not path.is_file():
        continue
    text = text_file(path)
    if text is None:
        continue
    replaced = IDENTIFIER.sub(lambda match: rename_identifier(match.group(0)), text)
    if replaced != text:
        path.write_text(replaced, encoding="utf-8", newline="")

# Renamed modules are imported without their extension.
for relative in ("cloud/src/scheduler.ts", "cloud/test/sh_health.test.ts"):
    path = ROOT / relative
    text = path.read_text(encoding="utf-8")
    text = text.replace('./stationhead_health"', './sh_health"')
    text = text.replace('../src/stationhead_health"', '../src/sh_health"')
    path.write_text(text, encoding="utf-8", newline="")

# Keep the device-sync wire format and D1 source keys stable while using SH
# names for local implementation variables.
path = ROOT / "cloud/src/device_control.ts"
text = path.read_text(encoding="utf-8")
text = text.replace(
    "const stationheadVersion = Number(states.sh?.version ?? 0);",
    "const shVersion = Number(states.stationhead?.version ?? 0);",
)
text = text.replace("      sh: stationheadVersion,", "      stationhead: shVersion,")
text = text.replace(
    "    if (row && row.version !== requested[source]) response[source] = row.payload;",
    "    const requestedSourceVersion = source === \"stationhead\" ? requested.sh : requested[source];\n"
    "    if (row && row.version !== requestedSourceVersion) response[source] = row.payload;",
)
path.write_text(text, encoding="utf-8", newline="")

path = ROOT / "cloud/src/snapshot.ts"
text = path.read_text(encoding="utf-8").replace("  sh?: unknown;", "  stationhead?: unknown;")
path.write_text(text, encoding="utf-8", newline="")

path = ROOT / "cloud/test/d1_meta_commands.integration.test.ts"
text = path.read_text(encoding="utf-8")
text = text.replace("      sh: 6,", "      stationhead: 6,")
text = text.replace(
    "versions: { dashboard: 27, radar: 8, switchbot: 5, sh: 6, config: 9 }",
    "versions: { dashboard: 27, radar: 8, switchbot: 5, stationhead: 6, config: 9 }",
)
path.write_text(text, encoding="utf-8", newline="")

for relative in TEMPORARY:
    path = ROOT / relative
    if path.exists():
        path.unlink()

# Guard the requested internal rename without banning the real service name or
# compatibility contracts.
remaining_paths = [
    item for item in git("ls-files").splitlines()
    if re.search("stationhead", item, re.IGNORECASE) and item not in RENAMES
]
if remaining_paths:
    raise SystemExit(f"Stationhead-named internal paths remain: {remaining_paths}")

remaining_identifiers: dict[str, list[str]] = {}
for relative in git("ls-files").splitlines():
    if relative in TEMPORARY:
        continue
    path = ROOT / relative
    if not path.is_file():
        continue
    text = text_file(path)
    if text is None:
        continue
    tokens = sorted({
        token for token in IDENTIFIER.findall(text)
        if "stationhead" in token.lower() and token not in PROTECTED
    })
    if tokens:
        remaining_identifiers[relative] = tokens
if remaining_identifiers:
    raise SystemExit(f"Stationhead-named internal identifiers remain: {remaining_identifiers}")

print("SH file and identifier refactor completed")
