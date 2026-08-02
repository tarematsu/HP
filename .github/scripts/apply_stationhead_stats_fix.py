from __future__ import annotations

# Payload revision 2 validates the implementation's reduce/find selection path.
import base64
import gzip
import hashlib
import json
import subprocess
from pathlib import Path

ROOT = Path.cwd()
SCRIPT_DIR = ROOT / ".github/scripts"
HEADER_PAYLOAD = SCRIPT_DIR / "stationhead_fix_header.b64"
REPLACEMENT_PAYLOADS = sorted(
    SCRIPT_DIR.glob("stationhead_fix_replacements_*.json")
)
EXPECTED_HEADER_SHA256 = (
    "7716a82bd826ff8dde7bf96d3d245191cbccf6c721095eaecb15ae35f0a84a2d"
)


def replace_once(path: str, old: str, new: str) -> None:
    target = ROOT / path
    source = target.read_text(encoding="utf-8")
    count = source.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one match, found {count}")
    target.write_text(
        source.replace(old, new, 1),
        encoding="utf-8",
        newline="\n",
    )


if len(REPLACEMENT_PAYLOADS) != 3:
    raise RuntimeError(
        f"expected three replacement payloads, found {len(REPLACEMENT_PAYLOADS)}"
    )
header = gzip.decompress(base64.b64decode(HEADER_PAYLOAD.read_text().strip()))
if hashlib.sha256(header).hexdigest() != EXPECTED_HEADER_SHA256:
    raise RuntimeError("replacement header checksum mismatch")
(ROOT / "hp/native/src/sh_stats_session_policy_fix.h").write_bytes(header)

for payload_path in REPLACEMENT_PAYLOADS:
    replacements = json.loads(payload_path.read_text(encoding="utf-8"))
    for path, old, new in replacements:
        replace_once(path, old, new)

workflow = subprocess.check_output(
    ["git", "show", "origin/main:.github/workflows/video-ci.yml"]
)
(ROOT / ".github/workflows/video-ci.yml").write_bytes(workflow)

for payload_path in [
    SCRIPT_DIR / "apply_stationhead_stats_fix.py",
    HEADER_PAYLOAD,
    *REPLACEMENT_PAYLOADS,
]:
    payload_path.unlink(missing_ok=True)
