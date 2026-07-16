from pathlib import Path

path = Path("native/src/sh.cpp")
text = path.read_text(encoding="utf-8")
old = """    if (lastAuthProbeAt_ > 0 && nowMs - lastAuthProbeAt_ >= kAuthProbeIntervalMs) {\n      PollAuthProbe(nowMs);\n    }\n"""
new = """    if (lastAuthProbeAt_ == 0 || nowMs - lastAuthProbeAt_ >= kAuthProbeIntervalMs) {\n      PollAuthProbe(nowMs);\n    }\n"""
count = text.count(old)
if count != 1:
    raise SystemExit(f"expected one secondary auth probe condition, found {count}")
path.write_text(text.replace(old, new, 1), encoding="utf-8")
