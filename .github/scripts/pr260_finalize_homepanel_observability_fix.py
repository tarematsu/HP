#!/usr/bin/env python3
from __future__ import annotations

import runpy
from pathlib import Path

runpy.run_path(".github/scripts/pr260_finish_homepanel_observability_fix.py", run_name="__main__")

path = Path(".github/scripts/audit-cloudflare-telemetry.py")
text = path.read_text(encoding="utf-8")
broken = 'output.write("\n".join(summary) + "\n")'
fixed = 'output.write("\\n".join(summary) + "\\n")'
if text.count(broken) != 1:
    raise SystemExit(f"expected one generated summary writer, found {text.count(broken)}")
path.write_text(text.replace(broken, fixed, 1), encoding="utf-8")

print("Normalized generated HomePanel observability source")
