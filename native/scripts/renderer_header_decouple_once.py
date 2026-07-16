from pathlib import Path

root = Path(__file__).resolve().parents[2]

for relative in ("native/src/app.cpp", "native/src/app_messages.cpp"):
    path = root / relative
    text = path.read_text(encoding="utf-8")
    marker = '#include "app.h"\n'
    include = '#include "web_renderer.h"\n'
    if include not in text:
        if marker not in text:
            raise RuntimeError(f"missing include marker: {relative}")
        path.write_text(text.replace(marker, marker + include, 1), encoding="utf-8", newline="\n")
